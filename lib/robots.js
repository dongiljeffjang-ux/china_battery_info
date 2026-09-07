// 남의 사이트 페이지를 읽기 전에 robots.txt를 확인하고 도메인별 요청 간격을 지킨다.
//
// 검색으로 찾은 기사는 어느 매체든 그대로 읽어 왔다. 봇을 막아 둔 매체나 자동 수집을 금지한 매체까지
// 읽으면 안 되므로, 본문을 가져오기 전에 그 도메인의 robots.txt에서 우리 UA와 '*'에 대한 Disallow를
// 본다. 막혀 있으면 본문을 읽지 않는다. Crawl-delay가 있으면 그 간격을, 없으면 같은 도메인 연속
// 요청에 최소 간격을 둔다. 거래소 공시(CNINFO·HKEX)와 CATL 뉴스룸은 이 경로를 타지 않는다.
//
// 캐시는 함수 인스턴스 메모리다. 서버리스 인스턴스는 한동안 재사용되므로 한 실행 안에서는 도메인당
// 한 번만 받는다. 인스턴스가 바뀌면 다시 받는다(하루 한 번 수준의 비용).

export const CRAWLER_UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)";
const UA_TOKEN = "chinabatterylens";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GAP_MS = 1500;
const MAX_CRAWL_DELAY_MS = 10000;

const cache = new Map();      // host → { fetchedAt, groups: [{agents, disallow, allow, delayMs}] }
const lastRequestAt = new Map(); // host → timestamp

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === "user-agent") {
      // 연속된 User-agent 줄은 같은 그룹이다.
      if (current && current.rules === 0) current.agents.push(value.toLowerCase());
      else { current = { agents: [value.toLowerCase()], disallow: [], allow: [], delayMs: null, rules: 0 }; groups.push(current); }
    } else if (current && (field === "disallow" || field === "allow")) {
      current.rules += 1;
      if (value) current[field].push(value);
    } else if (current && field === "crawl-delay") {
      current.rules += 1;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.delayMs = Math.min(seconds * 1000, MAX_CRAWL_DELAY_MS);
    }
  }
  return groups;
}

// 우리 UA를 이름으로 지목한 그룹이 있으면 그것을, 없으면 '*' 그룹을 쓴다. 표준 해석 순서다.
function pickGroup(groups) {
  return groups.find((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.includes(a)))
    || groups.find((g) => g.agents.includes("*"))
    || null;
}

function ruleToRegex(rule) {
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + (escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped));
}

// 가장 긴 규칙이 이긴다. 같은 길이면 Allow가 이긴다(구글 해석과 같다).
function isAllowed(group, path) {
  if (!group) return true;
  let best = { length: -1, allow: true };
  for (const rule of group.allow) if (ruleToRegex(rule).test(path) && rule.length >= best.length) best = { length: rule.length, allow: true };
  for (const rule of group.disallow) if (ruleToRegex(rule).test(path) && rule.length > best.length) best = { length: rule.length, allow: false };
  return best.allow;
}

async function loadRobots(origin) {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.groups;
  let groups = [];
  try {
    const response = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": CRAWLER_UA }, signal: AbortSignal.timeout(5000) });
    // 404·5xx·비텍스트는 "제한 없음"으로 본다. 4xx 중 401·403은 사이트가 접근을 막은 것이므로 읽지 않는다.
    if (response.status === 401 || response.status === 403) groups = [{ agents: ["*"], disallow: ["/"], allow: [], delayMs: null, rules: 1 }];
    else if (response.ok && /text\/plain/i.test(response.headers.get("content-type") || "text/plain")) groups = parseRobots(await response.text());
  } catch {
    groups = []; // 못 받으면 제한 없음. 연결 실패로 본문까지 못 읽는 것은 본문 요청이 따로 알린다.
  }
  cache.set(origin, { fetchedAt: Date.now(), groups });
  return groups;
}

// 읽어도 되는지 판정한다. { allowed, reason, delayMs }
export async function checkRobots(url) {
  let target;
  try { target = new URL(url); } catch { return { allowed: false, reason: "invalid_url", delayMs: 0 }; }
  const groups = await loadRobots(target.origin);
  const group = pickGroup(groups);
  const path = target.pathname + target.search;
  const allowed = isAllowed(group, path);
  return { allowed, reason: allowed ? null : "robots_disallowed", delayMs: group?.delayMs ?? DEFAULT_GAP_MS, host: target.host };
}

// 같은 도메인 연속 요청 사이에 간격을 둔다. 여러 기사가 동시에 처리돼도 도메인 하나에 몰리지 않게 한다.
export async function waitForHostSlot(host, delayMs = DEFAULT_GAP_MS) {
  const previous = lastRequestAt.get(host) || 0;
  const readyAt = Math.max(Date.now(), previous + delayMs);
  lastRequestAt.set(host, readyAt);
  const wait = readyAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

// 테스트용. 파싱·판정만 검사할 수 있게 내보낸다.
export const _internal = { parseRobots, pickGroup, isAllowed };
