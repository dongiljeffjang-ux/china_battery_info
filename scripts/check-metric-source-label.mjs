import assert from "node:assert/strict";
import fs from "node:fs";

// 그래프 점의 툴팁이 "어느 보고서에서 나온 값인지"를 밝히는지 검사한다. 네트워크를 쓰지 않는다.
//
// 왜 필요한가. 2026-09-08 사용자 지적: 툴팁이 '보고서 원문 발췌'라고만 적어서 (계획) 값이
// 몇 년도 보고서가 세운 계획인지 알 수 없었다. 계획값은 언제 세운 계획인지가 값 자체만큼
// 중요하다 — 2026년 보고서의 '2030년 20GWh'와 2022년 보고서의 같은 문장은 다른 정보다.
// 원인은 mergeMetricSources가 report_kind·occurred_at을 버리고 넘긴 것이었다.

const source = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8");

// --- 1) API가 출처 컬럼을 실제로 보낸다 ---------------------------------------

const select = source.length && api.slice(api.indexOf("const METRIC_SELECT"), api.indexOf("const METRIC_SELECT") + 300);
for (const column of ["report_kind", "occurred_at", "source_url"]) {
  assert.ok(select.includes(column), `METRIC_SELECT에 ${column}이 있어야 툴팁이 출처를 적을 수 있다`);
}

// --- 2) 화면이 그 값을 버리지 않고 넘긴다 --------------------------------------

const merge = source.slice(source.indexOf("function mergeMetricSources"), source.indexOf("const FINANCIAL_STALE_DAYS"));
assert.ok(merge.length > 400, "mergeMetricSources 구간을 찾지 못했다");
// 두 갈래(거래소 대조 행 / 발췌 전용 행) 모두에 출처가 실려야 한다.
assert.equal((merge.match(/report_kind:/g) || []).length, 2, "거래소 행과 발췌 행 모두 출처 보고서를 실어야 한다");
assert.equal((merge.match(/report_at:/g) || []).length, 2, "두 갈래 모두 보고서 시점을 실어야 한다");
assert.ok(/report_at: excerpt\?\.occurred_at/.test(merge), "거래소 행은 대조에 쓴 발췌의 보고서를 가리켜야 한다");
assert.ok(/report_at: row\.occurred_at/.test(merge), "발췌 전용 행은 그 발췌의 보고서를 가리켜야 한다");

// --- 3) 출처 문구를 만드는 함수 ------------------------------------------------

const helper = source.slice(source.indexOf("const REPORT_KIND_LABEL"), source.indexOf("function metricTip"));
const label = new Function(`${helper} return sourceReportLabel;`)();

assert.equal(label({ report_at: "2024-12-31", report_kind: "annual" }), "2024년 연차보고서");
assert.equal(label({ report_at: "2026-06-30", report_kind: "semiannual" }), "2026년 반기보고서");
assert.equal(label({ report_at: "2025-03-31", report_kind: "quarterly" }), "2025년 분기보고서");
// 종류를 모르면 연도라도 남긴다. 값은 있는데 출처가 통째로 사라지면 안 된다.
assert.equal(label({ report_at: "2024-12-31", report_kind: null }), "2024년 정기보고서");
assert.equal(label({ report_at: "2024-12-31", report_kind: "unknown_kind" }), "2024년 정기보고서");
// 아무것도 모르면 빈 문자열. 호출자가 옛 문구로 물러난다.
assert.equal(label({ report_at: null, report_kind: null }), "");
assert.equal(label({ report_at: "bogus", report_kind: null }), "");

// --- 4) 툴팁이 그 문구를 쓰고, 계획·누적을 실적과 구분한다 ----------------------

const tip = source.slice(source.indexOf("function metricTip"), source.indexOf("function clipText"));
assert.ok(tip.includes("const report = sourceReportLabel(row);"), "툴팁이 출처 문구를 만들어야 한다");
assert.ok(/\$\{report \|\| '보고서'\} 원문과 일치/.test(tip), "거래소 대조 문구에도 어느 보고서인지 적어야 한다");
assert.ok(/\$\{report\} 원문 발췌/.test(tip), "발췌 행은 어느 보고서의 발췌인지 적어야 한다");
assert.ok(tip.includes("'보고서 원문 발췌'"), "출처를 모를 때 쓰던 문구는 남겨 둔다");

// 계획·누적은 그 기간의 실적이 아니라는 것을 툴팁이 말해야 한다.
assert.ok(/_\(cum\|plan\)_/.test(tip), "지표 이름에서 계획·누적을 가려내야 한다");
assert.ok(tip.includes("계획값"), "계획값에는 전용 안내 줄이 있어야 한다");
assert.ok(tip.includes("누적값"), "누적값에는 전용 안내 줄이 있어야 한다");
assert.ok((tip.match(/그 기간의 실적이 아닙니다/g) || []).length === 2,
  "계획·누적 모두 실적이 아니라고 밝혀야 한다");

// --- 5) 계획값 첫 줄에 '누적'을 붙이지 않는다 ---------------------------------

// 분기·반기 실적은 연초부터의 누적이라 '누적'이 맞지만, 계획값은 누적이 아니라 그 시점에
// 밝힌 목표다. 첫 줄에 '누적'이 붙으면 아래 안내를 읽기 전에 실적으로 읽힌다.
const periodFn = new Function(`${source.slice(source.indexOf("const PERIOD_CAPTION"), source.indexOf("const isMoney"))} return periodLabel;`)();
assert.equal(periodFn({ at: { year: "2026", part: "H1" }, metric: "revenue_total" }), "2026 상반기 누적");
assert.equal(periodFn({ at: { year: "2026", part: "H1" }, metric: "capacity_plan_cell" }), "2026 상반기 시점");
assert.equal(periodFn({ at: { year: "2025", part: null }, metric: "capacity_plan_cell" }), "2025 시점");
assert.equal(periodFn({ at: { year: "2025", part: null }, metric: "revenue_total" }), "2025 연간");
// 누적 지표는 실제로 누적이므로 문구를 그대로 둔다.
assert.equal(periodFn({ at: { year: "2025", part: "Q3" }, metric: "shipment_cum_battery" }), "2025 3분기 누적");

console.log("ok  metric-source-label");
