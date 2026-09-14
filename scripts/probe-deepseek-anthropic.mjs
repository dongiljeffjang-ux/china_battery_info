// DeepSeek의 Anthropic 호환 엔드포인트가 서버 측 웹 검색을 실행하는지 1회 확인하는 진단 스크립트.
//
// 배경(docs/HANDOFF-CODEX.md 2026-09-12): Responses API 문서에서 web_search가 Ignored로 바뀌어 중국 현지
// 레인을 OpenAI로 옮겼다. Anthropic 호환 문서(/guides/anthropic_api/)는 `server_tool_use`·
// `web_search_tool_result` 응답 블록을 Supported로 적지만, 요청 `tools`에는 사용자 정의 함수 필드만 있어
// 이력 복원용일 가능성이 크다. 문서로는 못 가리므로 실호출 한 번으로 판정한다.
//
// 판정 기준: 응답 content에 `server_tool_use` 블록이 있고 그 안의 검색 결과(`web_search_tool_result`)가
// 실제 URL을 담으면 "살아 있음". 도구를 무시하고 text만 오거나, 400으로 거부되면 "없음".
//
// 사용(PowerShell):  $env:DEEPSEEK_API_KEY="..."; node scripts/probe-deepseek-anthropic.mjs --raw
// 사용(bash):        DEEPSEEK_API_KEY=... node scripts/probe-deepseek-anthropic.mjs --raw
// .env.local 의 값이 마스킹돼 있지 않으면 자동으로 읽는다. 키는 출력하지 않는다.
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env.local", ".env.production.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && !value.startsWith("[SENSITIVE") && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey || apiKey.startsWith("[SENSITIVE")) {
  console.error("DEEPSEEK_API_KEY가 없거나 마스킹돼 있다. 환경변수로 실제 키를 준다.");
  process.exit(1);
}
const raw = process.argv.includes("--raw");
const model = process.env.DEEPSEEK_SEARCH_MODEL || "deepseek-flash";
const url = "https://api.deepseek.com/anthropic/v1/messages";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Anthropic Messages API의 서버 측 웹 검색 도구 규격 그대로. DeepSeek이 이를 실행하는지가 질문이다.
const body = {
  model,
  max_tokens: 1500,
  system: "중국 이차전지 산업 뉴스 리서처다. 웹 검색 도구를 반드시 한 번 이상 실행하고, 검색 결과에 실제로 있는 기사만 반환한다. URL·제목·날짜를 만들어내지 않는다.",
  messages: [{ role: "user", content: `오늘(${today}) 또는 어제 발행된 宁德时代(CATL)·比亚迪(BYD) 관련 중국어 기사를 최대 3건 찾아 제목·URL·매체·발행일을 JSON 배열로 답하라. 검색 결과에 없으면 빈 배열을 반환하라.` }],
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
};

const started = Date.now();
const upstream = await fetch(url, {
  method: "POST",
  headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(60000),
});
console.log(`[config] model=${model} url=${url}`);
console.log(`[http] status=${upstream.status} ms=${Date.now() - started}`);
const text = await upstream.text();
if (!upstream.ok) {
  console.log("[error body]", text.slice(0, 1500));
  console.log("[verdict] 요청이 거부됐다. 400이면 web_search 도구 타입 자체를 받지 않는 것이다.");
  process.exit(2);
}
const payload = JSON.parse(text);
const blocks = payload.content || [];
const types = blocks.map((block) => block.type);
console.log(`[model returned] ${payload.model || "?"}  stop_reason=${payload.stop_reason || "?"}`);
console.log(`[content types] ${types.join(",") || "none"}`);
console.log(`[usage] ${JSON.stringify(payload.usage || null)}`);
if (raw) console.log(JSON.stringify(payload, null, 2).slice(0, 8000));

const serverToolUse = blocks.filter((block) => block.type === "server_tool_use");
const searchResults = blocks.filter((block) => block.type === "web_search_tool_result");
const resultUrls = searchResults.flatMap((block) => (Array.isArray(block.content) ? block.content : []).map((item) => item.url).filter(Boolean));
const textOut = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
console.log(`[server_tool_use] ${serverToolUse.length}  [web_search_tool_result] ${searchResults.length}  [result urls] ${resultUrls.length}`);
for (const u of resultUrls.slice(0, 8)) console.log(`   ${u}`);
if (textOut) console.log("[text]", textOut.slice(0, 1200));

if (serverToolUse.length && resultUrls.length) {
  console.log("[verdict] 살아 있음 — Anthropic 호환 경로에서 서버 측 웹 검색이 실행됐다. 중국 현지 레인을 DeepSeek으로 되돌릴 근거가 된다(엔진 연결 코드는 별도).");
  process.exit(0);
}
if (payload.usage?.server_tool_use?.web_search_requests) {
  console.log("[verdict] usage에는 검색 횟수가 찍혔지만 결과 블록이 없다. --raw로 본문을 확인한다.");
  process.exit(5);
}
console.log("[verdict] 없음 — 도구를 무시하고 텍스트만 반환했다. 문서의 server_tool_use 행은 이력 복원용이라는 해석이 맞다.");
process.exit(3);
