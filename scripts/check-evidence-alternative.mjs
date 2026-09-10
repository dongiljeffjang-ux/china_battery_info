// 웹 검증 교정은 원래 값을 덮지 않고 "다른 근거"로 붙는다. 네트워크는 가짜로 물린다.
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || "GET", prefer: options.headers?.Prefer, body: options.body ? JSON.parse(options.body) : null });
  const body = String(url).includes("evidence_alternative") ? [{ id: "alt-1" }] : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const { applyVerifiedFacts, alternativeRowFor } = await import("../lib/compare-report.js");
const { metricTable } = await import("../lib/timeline-report.js");

const A = { id: "hunan-yuneng", name_ko: "후난위넝" };
const B = { id: "catl", name_ko: "닝더스다이(CATL)" };
const eventA = "3b955e54-cb3e-4745-8e49-5948891ad72d";
const eventOwner = new Map([[eventA, A.id]]);
const base = { original_ko: "원래", corrected_ko: "다른 출처 서술", reason_ko: "이유", source_url: "https://example.com/r.pdf", occurred_at: "", occurred_precision: "" };

// 1) 대상 판정
assert.equal(alternativeRowFor({ ...base, field: "number", company: "A", metric_period: "2026H1", metric_key: "capacity_cathode_lfp", event_id: "" }, { companyA: A, companyB: B, eventOwner }).target_kind, "metric", "정량 칸 키가 있으면 수치 칸에 붙는다");
assert.equal(alternativeRowFor({ ...base, field: "number", company: "", metric_period: "", metric_key: "", event_id: eventA }, { companyA: A, companyB: B, eventOwner }).target_kind, "event", "정량 칸이 아니고 우리 이벤트면 이벤트에 붙는다");
assert.equal(alternativeRowFor({ ...base, field: "number", company: "A", metric_period: "2026H1", metric_key: "made_up_metric", event_id: "" }, { companyA: A, companyB: B, eventOwner }), null, "모르는 지표 키는 저장하지 않는다");
assert.equal(alternativeRowFor({ ...base, source_url: "", field: "number", company: "A", metric_period: "2026H1", metric_key: "capacity_cathode_lfp", event_id: "" }, { companyA: A, companyB: B, eventOwner }), null, "출처 없는 교정은 저장하지 않는다");
assert.equal(alternativeRowFor({ ...base, field: "occurred_at", event_id: eventA }, { companyA: A, companyB: B, eventOwner }), null, "날짜 교정은 다른 근거가 아니라 시점 수정 경로다");

// 2) DB 반영: report_metric·event 사실은 PATCH하지 않고, 다른 근거는 중복 무시로 넣는다.
const report = { verification: { corrections: [
  { ...base, field: "occurred_at", event_id: eventA, occurred_at: "2026-03-05", occurred_precision: "day", company: "", metric_period: "", metric_key: "" },
  { ...base, field: "number", company: "A", metric_period: "2026H1", metric_key: "capacity_cathode_lfp", event_id: eventA },
  { ...base, field: "subject", company: "", metric_period: "", metric_key: "", event_id: "not-on-screen" },
], added_evidence: [] } };
const summary = await applyVerifiedFacts({ companyA: A, companyB: B, report, eventIdsA: [eventA], eventIdsB: [] });
const [dateFix, numberFix, loose] = report.verification.corrections;
assert.equal(dateFix.db_action, "date_fixed");
assert.equal(numberFix.db_action, "alternative_added");
assert.equal(loose.db_action, "report_only", "화면에 없는 이벤트를 짚은 교정은 리포트에만 남는다");
assert.equal(summary.alternatives_added, 1);
assert.ok(!calls.some(call => call.url.includes("report_metric") && call.method !== "GET"), "원래 정량 값은 절대 고치지 않는다");
const patches = calls.filter(call => call.method === "PATCH");
assert.equal(patches.length, 1, "PATCH는 날짜 교정 한 건뿐이다");
assert.deepEqual(Object.keys(patches[0].body).sort(), ["occurred_at", "occurred_basis", "occurred_precision"], "이벤트 사실 문장은 건드리지 않는다");
const insert = calls.find(call => call.url.includes("evidence_alternative"));
assert.ok(insert.url.includes("on_conflict=dedupe_key") && insert.prefer.includes("resolution=ignore-duplicates"), "같은 다른 근거는 두 번 쌓지 않는다");
assert.equal(insert.body.metric, "capacity_cathode_lfp");
assert.equal(insert.body.claim_ko, "다른 출처 서술");
assert.match(insert.body.dedupe_key, /^[0-9a-f]{64}$/);

// 3) 저장 실패(SQL 미적용)여도 리포트는 계속된다.
globalThis.fetch = async () => new Response('{"message":"relation does not exist"}', { status: 404 });
const report2 = { verification: { corrections: [{ ...base, field: "number", company: "A", metric_period: "2026H1", metric_key: "capacity_cathode_lfp", event_id: "" }], added_evidence: [] } };
const summary2 = await applyVerifiedFacts({ companyA: A, companyB: B, report: report2, eventIdsA: [], eventIdsB: [] });
assert.equal(report2.verification.corrections[0].db_action, "report_only");
assert.match(summary2.skipped[0], /다른 근거 저장 실패/);

// 4) 리포트 입력: 원래 값은 표에 그대로, 다른 근거는 표 아래 따로.
const rows = [{ period: "2025", metric: "capacity_cathode_lfp", value: 850000, unit: "t" }, { period: "2026H1", metric: "capacity_cathode_lfp", value: 704000, unit: "t" }];
const table = metricTable(rows, { alternatives: [{ target_kind: "metric", period: "2026H1", metric: "capacity_cathode_lfp", claim_ko: "994,500톤이라는 출처", source_url: "https://example.com/r.pdf" }] });
assert.ok(table.includes("| 70.4 |"), "원래 값은 표에서 바뀌지 않는다");
assert.match(table, /상충 근거 · 생산능력 · 인산철리튬 양극재\(만 톤\) 2026H1: 994,500톤이라는 출처/);
assert.equal(metricTable(rows), metricTable(rows, { alternatives: [] }), "다른 근거가 없으면 표는 예전과 같다");

// 5) 검증기 스키마와 SQL
const lib = fs.readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
assert.match(lib, /required: \[[^\]]*"company", "metric_period", "metric_key"\]/, "검증기가 정량 칸 키를 짚어야 한다");
assert.match(lib, /\[정량 칸 키\]/, "검증 입력에 정량 칸 키 목록이 있어야 한다");
const sql = fs.readFileSync(new URL("../supabase/evidence-alternative.sql", import.meta.url), "utf8");
assert.match(sql, /create table if not exists public\.evidence_alternative/);
assert.match(sql, /dedupe_key text not null unique/);
assert.match(sql, /revoke all on public\.evidence_alternative from anon, authenticated/);

console.log("evidence alternative checks passed");
