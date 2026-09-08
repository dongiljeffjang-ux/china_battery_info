// 정기보고서 이벤트의 중문 발췌에서 지표를 뽑아 커버리지를 재거나 report_metric에 채운다.
//
//   node --env-file=.env scripts/backfill-report-metrics.mjs            # 실측만 (DB 쓰기 없음)
//   node --env-file=.env scripts/backfill-report-metrics.mjs --write    # report_metric에 upsert
//
// LLM을 쓰지 않는다. 외부 호출은 Supabase 읽기(+ --write일 때 쓰기)뿐이다.
// 기본은 dry-run이다 — 운영 DB에 쓰기 전에 무엇이 들어갈지 먼저 눈으로 본다.

import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { extractMetricsFromEvents } from "../lib/report-metrics.js";

const WRITE = process.argv.includes("--write");
const SELECT = "id,company_id,evidence_kind,occurred_at,source_url,original_excerpt";
const PAGE = 500;

if (!hasDatabaseConfig()) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없다. --env-file=.env로 실행한다.");
  process.exit(1);
}

const events = [];
for (let offset = 0; ; offset += PAGE) {
  const page = await supabaseRest(
    `event?select=${SELECT}&evidence_kind=in.(annual_report,periodic_report)&order=occurred_at.desc&limit=${PAGE}&offset=${offset}`,
  );
  events.push(...page);
  if (page.length < PAGE) break;
}

const rows = extractMetricsFromEvents(events);
const byMetric = new Map();
for (const row of rows) byMetric.set(row.metric, (byMetric.get(row.metric) || 0) + 1);

console.log(`이벤트 ${events.length}건 → 지표 ${rows.length}행`);
for (const [metric, count] of [...byMetric.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${metric.padEnd(18)} ${count}`);
}

// 매출 커버리지: 회사 × 연도 몇 칸이 찼는가. PRD 8절 게이트가 보는 수치다.
const years = ["2023", "2024", "2025"];
const revenue = rows.filter((row) => row.metric === "revenue_total" && years.includes(row.period));
const filled = new Set(revenue.map((row) => `${row.company_id} ${row.period}`));
const companies = [...new Set(events.map((event) => event.company_id))];
console.log(`\n매출(연간) 커버리지: ${filled.size} / ${companies.length * years.length} 칸 (회사 ${companies.length}사 × ${years.length}년)`);
for (const year of years) {
  const n = revenue.filter((row) => row.period === year).length;
  console.log(`  ${year}: ${n}사`);
}

const missing = companies.filter((id) => !years.some((year) => filled.has(`${id} ${year}`))).sort();
if (missing.length) console.log(`\n3년 내내 매출이 없는 회사(${missing.length}): ${missing.join(", ")}`);

console.log("\n표본 10행:");
for (const row of rows.slice(0, 10)) {
  console.log(`  ${row.company_id} ${row.period} ${row.metric} = ${row.value} (${row.line_item_zh} · "${row.quantity_text}")`);
}

if (!WRITE) {
  console.log("\ndry-run. DB에 쓰지 않았다. 실제로 채우려면 --write.");
  process.exit(0);
}

const payload = rows.map((row) => ({
  company_id: row.company_id, period: row.period, metric: row.metric,
  value: row.value, unit: row.unit, currency: row.currency,
  line_item_zh: row.line_item_zh, quantity_text: row.quantity_text,
  yoy_pct_stated: row.yoy_pct_stated, excerpt: row.excerpt,
  event_id: row.event_id, report_kind: row.report_kind,
  source_url: row.source_url, occurred_at: row.occurred_at,
  extractor: "report-metrics/regex",
}));
for (let i = 0; i < payload.length; i += 200) {
  await supabaseRest("report_metric?on_conflict=company_id,period,metric", {
    method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: payload.slice(i, i + 200),
  });
}
console.log(`\nreport_metric에 ${payload.length}행 upsert 완료.`);
