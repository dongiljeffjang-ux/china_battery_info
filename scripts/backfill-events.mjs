// 과거 기업 시계열 1회 백필.
//
//   node --env-file=.env scripts/backfill-events.mjs [--since 2023-01-01] [--only catl,byd]
//
// 회사 1곳당 웹 검색 1회로 과거 주요 사실을 받아 event 행 후보를 만든다.
// DB에는 쓰지 않고 outputs/backfill/events.json에 남긴다. 적재는 별도로 검토 후 수행한다.
//
// 본문 정독·교차검증을 거치지 않으므로 timeline_eligibility는 reference로 고정하고
// source_tier는 backfill_web_search로 남겨 일반 이벤트와 구분한다.

import fs from "node:fs";
import path from "node:path";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { COMPANIES } from "../lib/china-sources.js";
import { groupSearchEntities, matchGroupEntities } from "../lib/company-groups.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "../lib/timeline-layers.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const SINCE = argOf("--since", "2023-01-01");
const UNTIL = new Date().toISOString().slice(0, 10);
const ONLY = argOf("--only", "").split(",").map((value) => value.trim()).filter(Boolean);
const MAX_EVENTS = Number(argOf("--max", "20"));
const OUT_DIR = path.join("outputs", "backfill");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      maxItems: MAX_EVENTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["occurred_at", "title_ko", "fact_ko", "trajectory_track", "layer_key", "region_scope", "source_url", "source_name", "original_excerpt", "original_excerpt_ko"],
        properties: {
          occurred_at: { type: "string" },
          title_ko: { type: "string" },
          fact_ko: { type: "string" },
          trajectory_track: { type: "string", enum: ["market", "technology", "both"] },
          layer_key: { type: "string", enum: LAYER_ENUM },
          region_scope: { type: ["string", "null"] },
          source_url: { type: "string" },
          source_name: { type: "string" },
          original_excerpt: { type: "string" },
          original_excerpt_ko: { type: "string" },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "중국 배터리 산업 리서처다. 웹 검색으로 특정 회사의 과거 주요 사실을 모은다.",
  "검색 결과에 실제로 제시된 원문 기사·공시 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다.",
  "출처에 명시된 사실만 한국어로 쓴다. 전망·인과 추정·성공 가능성·투자 판단을 만들지 않는다.",
  "occurred_at은 사건이 일어난 날짜를 YYYY-MM-DD로 쓴다. 기사 발행일이 아니라 본문이 말하는 사건일을 우선한다. 날짜가 불명확한 항목은 반환하지 않는다.",
  "original_excerpt에는 근거가 되는 원문을 300자 이내로 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다.",
  "같은 사건을 중복해 넣지 않는다. 분기별로 고르게 분포하도록 시기가 다른 사실을 우선한다.",
  "주가 단신, 애널리스트 목표주가, 자동차 소비자 리뷰, 광고는 제외한다.",
  LAYER_PROMPT_GUIDE,
].join(" ");

function hostnameOf(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.hostname : null;
  } catch {
    return null;
  }
}

async function backfillCompany(company) {
  const entities = groupSearchEntities(company.id);
  const names = [company.name_zh, company.name_en].filter(Boolean).join(" / ");
  const groupLine = entities.length ? `\n같은 그룹의 주요 계열사도 함께 찾는다: ${entities.join(" / ")}` : "";
  const result = await createJsonResponse({
    name: "company_timeline_backfill",
    schema,
    webSearch: true,
    instructions: INSTRUCTIONS,
    input: `회사: ${company.name_ko} [${names}]${groupLine}\n기간: ${SINCE} ~ ${UNTIL}\n이 기간에 이 회사(또는 명시된 계열사)에서 실제로 일어난 주요 사실을 최대 ${MAX_EVENTS}건 찾으세요. 증설·가동·생산능력, 고객 인증·수주·공급계약, 제품·기술·특허, 실적·가격, 해외 진출·현지 법인을 우선합니다.`,
  });

  const citations = new Set((result.sourceUrls || []).map(hostnameOf).filter(Boolean));
  const rows = [];
  const dropped = { badDate: 0, badUrl: 0, uncited: 0 };
  for (const event of result.data.events || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.occurred_at) || event.occurred_at < SINCE || event.occurred_at > UNTIL) {
      dropped.badDate += 1;
      continue;
    }
    const host = hostnameOf(event.source_url);
    if (!host) {
      dropped.badUrl += 1;
      continue;
    }
    // 검색이 실제로 인용한 도메인만 채택한다. 모델이 URL을 지어내는 것을 막는 장치다.
    if (citations.size && !citations.has(host)) {
      dropped.uncited += 1;
      continue;
    }
    rows.push({
      company_id: company.id,
      occurred_at: event.occurred_at,
      title_ko: event.title_ko,
      fact_ko: event.fact_ko,
      trajectory_track: event.trajectory_track,
      layer_key: normalizeLayerKey(event.layer_key),
      region_scope: event.region_scope || null,
      source_url: event.source_url,
      source_name: event.source_name,
      original_excerpt: event.original_excerpt,
      original_excerpt_ko: event.original_excerpt_ko,
      timeline_eligibility: "reference",
      entity_names: matchGroupEntities(company.id, `${event.title_ko} ${event.fact_ko} ${event.original_excerpt}`),
    });
  }
  return { rows, dropped, returned: (result.data.events || []).length, provider: result.provider };
}

if (!llmConfig("auto")) {
  console.error("LLM 키가 없습니다. .env에 OPENAI_API_KEY와 OPENAI_MODEL을 채운 뒤 다시 실행하세요.");
  process.exit(1);
}

const targets = COMPANIES.filter((company) => !ONLY.length || ONLY.includes(company.id));
console.log(`백필 ${targets.length}개사 · 기간 ${SINCE} ~ ${UNTIL} · 회사당 최대 ${MAX_EVENTS}건`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const all = [];
const report = [];
for (const [index, company] of targets.entries()) {
  const label = `${String(index + 1).padStart(2)}/${targets.length} ${company.id}`;
  try {
    const { rows, dropped, returned, provider } = await backfillCompany(company);
    all.push(...rows);
    const drops = Object.entries(dropped).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" ");
    console.log(`${label.padEnd(28)} 채택 ${String(rows.length).padStart(2)} / 응답 ${String(returned).padStart(2)}  ${drops || ""}  (${provider})`);
    report.push({ company_id: company.id, kept: rows.length, returned, dropped });
  } catch (error) {
    console.log(`${label.padEnd(28)} 실패: ${error.message}`);
    report.push({ company_id: company.id, error: error.message });
  }
}

const outFile = path.join(OUT_DIR, "events.json");
fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), since: SINCE, until: UNTIL, report, events: all }, null, 2), "utf8");
const byYear = all.reduce((acc, row) => ({ ...acc, [row.occurred_at.slice(0, 4)]: (acc[row.occurred_at.slice(0, 4)] || 0) + 1 }), {});
console.log(`\n이벤트 후보 ${all.length}건 → ${outFile}`);
console.log("연도별:", Object.entries(byYear).sort().map(([y, n]) => `${y} ${n}`).join(" · "));
console.log(`회사 커버리지: ${new Set(all.map((row) => row.company_id)).size} / ${targets.length}`);
