import assert from "node:assert/strict";
import fs from "node:fs";

// 재무 자동 갱신은 야간 크론에 얹혀 돈다. 여기서 지켜야 할 것은 세 가지다.
//   1) 크론 실행에서만 돌 것 — 화면 버튼이 누를 때마다 남의 서버를 두드리면 안 된다.
//   2) 실패해도 수집 파이프라인을 멈추지 않을 것.
//   3) 실패를 조용히 삼키지 말 것 — 로그에 남고 화면이 그것을 읽어 알린다.
const ingest = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
const company = fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

const refresh = ingest.slice(ingest.indexOf("async function refreshFinancialsIfDue"), ingest.indexOf("async function runFinancialBackfill"));
assert.ok(refresh, "자동 갱신 함수가 있어야 한다");

// 1) 크론에서만, 주기가 지났을 때만.
const callSite = ingest.slice(ingest.indexOf("// 재무 자동 갱신. 크론 실행에서만"), ingest.indexOf("const discovery = discoveryStats()"));
assert.ok(/if \(isCronRequest\(request\)\)/.test(callSite), "자동 갱신은 크론 실행에서만 돌아야 한다");
assert.ok(/refreshFinancialsIfDue\(\)/.test(callSite), "호출부가 있어야 한다");
assert.ok(/force = false/.test(refresh) && /!force && !\(await financialRefreshDue\(\)\)/.test(refresh), "주기가 안 지났으면 건너뛰어야 한다");
const days = Number(ingest.match(/const FINANCIAL_REFRESH_DAYS = (\d+);/)?.[1]);
assert.ok(days >= 1 && days <= 31, `갱신 주기가 이상하다(${days}일)`);

// 2) 실패가 수집을 멈추지 않는다.
assert.ok(/try \{ await refreshFinancialsIfDue\(\); \}\s*\n\s*catch/.test(callSite), "자동 갱신 실패가 수집 단계를 멈추면 안 된다");

// 3) 실패를 남기고 화면이 읽는다.
assert.ok(/logPipeline\(FINANCIAL_STAGE, [^;]*status: "failed"/s.test(refresh), "실패를 pipeline_log에 남겨야 한다");
assert.ok(/status: failed\.length \? "partial" : "ok"/.test(refresh), "일부 실패는 partial로 구분해야 한다");
assert.ok(/if \(!rows\.length\)/.test(refresh), "한 건도 못 받으면 쓰지 않아야 한다");
assert.ok(company.includes("stage=eq.financials"), "기업 API가 마지막 갱신 결과를 실어 보내야 한다");
assert.ok(company.includes("financials_status"), "응답에 갱신 상태가 있어야 한다");

// 화면이 실패·부분실패·지연을 각각 다른 문구로 알린다.
const warn = app.slice(app.indexOf("function financialFreshnessWarning"), app.indexOf("function renderTrajectory"));
for (const [label, needle] of [["실패", "자동 갱신이 실패"], ["부분 실패", "일부만 성공"], ["지연", "일째 갱신되지 않았습니다"], ["기록 없음", "갱신 기록이 없습니다"]]) {
  assert.ok(warn.includes(needle), `${label} 상태를 알리는 문구가 있어야 한다`);
}
assert.ok(/status\.status === 'failed'/.test(warn) && /status\.status === 'partial'/.test(warn), "상태별로 문구가 갈려야 한다");
assert.ok(app.includes('class="traj-warn"'), "경고를 화면에 그려야 한다");

// 갱신 경로에 LLM이 끼어들면 야간 비용이 조용히 늘어난다.
assert.ok(!/createJsonResponse|llmConfig/.test(refresh), "자동 갱신은 LLM을 쓰지 않는다");

console.log("financial refresh checks passed");
