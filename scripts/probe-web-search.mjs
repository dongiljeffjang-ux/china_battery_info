// 검색 제공자 한 곳이 지금 실제로 기사 후보를 돌려주는지 확인하는 진단 스크립트.
//
// 운영 DB에 DeepSeek 검색으로 발견된 기사가 누적 0건이라, 수집 파이프라인과 같은 프롬프트·스키마·
// 도구 설정으로 검색 한 번을 직접 호출해 결과 또는 실패 사유를 그대로 찍는다.
//
// 사용(PowerShell):  $env:DEEPSEEK_API_KEY="..."; node scripts/probe-web-search.mjs deepseek --raw
// 사용(bash):        DEEPSEEK_API_KEY=... node scripts/probe-web-search.mjs deepseek --raw
//
// 키를 매번 넣기 번거로우면 `vercel env pull .env.local`로 받아 두면 아래에서 자동으로 읽는다.
// .env* 는 .gitignore에 있어 커밋되지 않는다.
// --raw 를 붙이면 Responses API 응답 본문(output 항목 종류)까지 보여 준다.
import { readFileSync, existsSync } from "node:fs";
import { llmConfig, responseOutputText } from "../lib/llm-provider.js";

// PowerShell에는 `VAR=값 명령` 문법이 없어 키가 조용히 비는 일이 잦다. 로컬 .env 파일도 후보로 본다.
for (const file of [".env.local", ".env.production.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
  console.log(`[env] ${file}에서 값을 읽었다.`);
}

const provider = process.argv[2] === "openai" ? "openai" : "deepseek";
const raw = process.argv.includes("--raw");
const config = llmConfig(provider);
if (!config) {
  console.error(`${provider.toUpperCase()} 키가 없다. ${provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY와 OPENAI_MODEL"}을 환경변수로 준다.`);
  process.exit(1);
}
console.log(`[config] provider=${config.provider} model=${config.model} url=${config.url} thinking=${config.thinking ?? "n/a"}`);

// lib/china-sources.js discoverWebSearchNews와 같은 모양. 회사 목록만 줄여 빠르게 본다.
const schema = {
  type: "object", additionalProperties: false, required: ["articles"],
  properties: { articles: { type: "array", maxItems: 6, items: {
    type: "object", additionalProperties: false,
    required: ["title", "url", "source_name", "published_at", "snippet"],
    properties: { title: { type: "string" }, url: { type: "string" }, source_name: { type: "string" }, published_at: { type: ["string", "null"] }, snippet: { type: "string" } }
  } } }
};
const body = {
  model: config.model,
  instructions: "중국 이차전지 산업 뉴스 리서처다. 웹 검색을 이용한다. 검색 결과에 실제로 제시된 원문 기사 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다.",
  input: "최근 3일 사이 宁德时代(CATL)·容百科技(Ronbay)·贝特瑞(BTR)의 증설·수주·기술·재무 관련 중국어 기사 후보를 최대 6건 찾아 제목, 원문 URL, 매체명, 발행일, 1~2문장 요약을 반환하세요.",
  text: { format: { type: "json_schema", name: "probe_candidates", strict: true, schema } },
  tools: [{ type: "web_search" }],
};
if (config.provider === "openai") { body.store = false; body.tool_choice = { type: "web_search" }; body.include = ["web_search_call.action.sources"]; }
else { body.reasoning = { effort: config.thinking ? "low" : "none" }; body.tool_choice = "required"; }

const started = Date.now();
const upstream = await fetch(config.url, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
console.log(`[http] status=${upstream.status} ms=${Date.now() - started}`);
const text = await upstream.text();
if (!upstream.ok) { console.log("[error body]", text.slice(0, 1500)); process.exit(2); }
const payload = JSON.parse(text);
const types = (payload.output || []).map((item) => item.type);
console.log(`[output types] ${types.join(",") || "none"}  status=${payload.status || "?"}  incomplete=${JSON.stringify(payload.incomplete_details || null)}`);
if (raw) console.log(JSON.stringify(payload, null, 2).slice(0, 6000));
const outputText = responseOutputText(payload);
if (!outputText) { console.log("[result] EMPTY_OUTPUT — 검색만 돌고 최종 JSON을 내지 않았다. 파이프라인에서는 [WEB_SEARCH_FAILED]로 기록되고 후보 0건이 된다."); process.exit(3); }
try {
  const data = JSON.parse(outputText);
  console.log(`[result] articles=${(data.articles || []).length}`);
  for (const item of data.articles || []) console.log(` - ${item.published_at || "날짜없음"} | ${item.source_name} | ${item.title}\n   ${item.url}`);
} catch {
  console.log("[result] INVALID_JSON_OUTPUT\n", outputText.slice(0, 1500));
  process.exit(4);
}
