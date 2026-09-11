import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTimeoutError, retryOnceOnTimeout } from "../lib/timeout-retry.js";
import { llmConfig } from "../lib/llm-provider.js";

const daily = readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
const ingest = readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
const timelineReport = readFileSync(new URL("../lib/timeline-report.js", import.meta.url), "utf8");
const compareReport = readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
assert.match(daily, /DAILY_LLM_TIMEOUT_MS = 90000/);
assert.match(daily, /timeoutMs: DAILY_LLM_TIMEOUT_MS/);
assert.match(daily, /provider: "openai_report"/);
assert.match(timelineReport, /name: "company_timeline_report",\s*provider: "openai_report"/s);
// 초안·웹 검증·함의 종합. 모두 리포트 전용 API를 쓴다. 정책–회사 연결 판정은 lib/policy-links.js로 옮겼다.
assert.equal((compareReport.match(/provider: "openai_report"/g) || []).length, 3);
const policyLinks = readFileSync(new URL("../lib/policy-links.js", import.meta.url), "utf8");
assert.match(policyLinks, /name: "company_policy_links",\s*schema: LINK_SHAPE,\s*provider: "openai_report"/s, "정책 연결 판정도 리포트 전용 API를 쓴다");
assert.match(ingest, /retryOnceOnTimeout\(\s*\(\) => generateDailyReport\(\),\s*\{ delayMs: 1500 \}/s);
const companyApi = readFileSync(new URL("../api/company.js", import.meta.url), "utf8");
assert.match(companyApi, /retryOnceOnTimeout\(\s*\(\) => buildTimelineReport\(\{ companyName: company\.name_ko, reportMode, events, metrics, alternatives, policies, policyLinks: policyLinks\.links \}\),\s*\{ delayMs: 1500 \}/s, "시계열 리포트도 TimeoutError일 때만 한 번 재시도해야 한다");
assert.match(companyApi, /retryOnceOnTimeout\(\s*\(\) => buildCompareReport\(\{ companyIdA: a\.id, companyIdB: b\.id, nameA: a\.name_ko, nameB: b\.name_ko, eventsA, eventsB, metricsA, metricsB, alternativesA, alternativesB, policies, policyLinksA: linksA\.links, policyLinksB: linksB\.links, policyStatus, pairContext: pairContextValue \}\),\s*\{ delayMs: 1500 \}/s, "비교 리포트도 TimeoutError일 때만 한 번 재시도해야 한다");

// 리포트가 아닌 OpenAI 호출은 항상 일반(Luna) API 키·모델을 사용한다.
const savedEnv = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  reportApiKey: process.env.OPENAI_REPORT_API_KEY,
  reportModel: process.env.OPENAI_REPORT_MODEL,
};
process.env.OPENAI_API_KEY = "luna-key";
process.env.OPENAI_MODEL = "gpt-5.6-luna";
process.env.OPENAI_REPORT_API_KEY = "terra-key";
process.env.OPENAI_REPORT_MODEL = "gpt-5.6-terra";
assert.deepEqual(llmConfig("auto"), {
  provider: "openai", url: "https://api.openai.com/v1/responses", apiKey: "luna-key", model: "gpt-5.6-luna"
});
assert.deepEqual(llmConfig("openai"), llmConfig("auto"));
assert.deepEqual(llmConfig("openai_report"), {
  provider: "openai", route: "report", url: "https://api.openai.com/v1/responses", apiKey: "terra-key", model: "gpt-5.6-terra"
});
for (const [key, value] of Object.entries({
  OPENAI_API_KEY: savedEnv.apiKey,
  OPENAI_MODEL: savedEnv.model,
  OPENAI_REPORT_API_KEY: savedEnv.reportApiKey,
  OPENAI_REPORT_MODEL: savedEnv.reportModel,
})) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}

assert.equal(isTimeoutError({ name: "TimeoutError" }), true);
assert.equal(isTimeoutError({ name: "AbortError" }), true);
assert.equal(isTimeoutError({ name: "TypeError" }), false);

let calls = 0;
let paused = 0;
const recovered = await retryOnceOnTimeout(async ({ attempt }) => {
  calls += 1;
  if (attempt === 1) throw Object.assign(new Error("late"), { name: "TimeoutError" });
  return "published";
}, { delayMs: 7, sleep: async (ms) => { paused = ms; } });
assert.equal(recovered, "published");
assert.equal(calls, 2);
assert.equal(paused, 7);

calls = 0;
await assert.rejects(
  retryOnceOnTimeout(async () => { calls += 1; throw Object.assign(new Error("bad request"), { name: "TypeError" }); }, { sleep: async () => {} }),
  /bad request/
);
assert.equal(calls, 1);
console.log("timeout retry regression checks passed");
