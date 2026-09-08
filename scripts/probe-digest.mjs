// 정기보고서 한 건을 현재 코드로 다시 읽어 "LLM이 몇 건을 냈고, 검증이 몇 건을 버렸고, 몇 건이
// 저장 가능한지"를 본다. DB에 쓰지 않는다. 추출 재현율을 진단하는 용도다(docs/PLAN-embedding-recovery.md T0.1).
//
// 사용:
//   node scripts/probe-digest.mjs <company_id> <annual|semiannual> <report_url>
//   node scripts/probe-digest.mjs wanrun-new-energy semiannual https://static.cninfo.com.cn/finalpage/2026-08-29/1225524978.PDF
//
// LLM 호출이 나간다(조각 수만큼). 키는 .env.local → .env 순으로 읽는다.
// 결과는 stdout과 outputs/probe-digest-<company>-<timestamp>.json에 남긴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const file of [".env.local", ".env.production.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

const [companyId, kind = "semiannual", knownUrl] = process.argv.slice(2);
if (!companyId || !knownUrl) {
  console.error("사용: node scripts/probe-digest.mjs <company_id> <annual|semiannual> <report_url>");
  process.exit(1);
}

const { COMPANIES } = await import("../lib/china-sources.js");
const { digestReport } = await import("../lib/event-backfill.js");

const company = COMPANIES.find((item) => item.id === companyId);
if (!company) { console.error(`모르는 회사: ${companyId}`); process.exit(1); }

const started = Date.now();
const result = await digestReport({ company, kind, knownUrl, maxEvents: 30, timeoutMs: 120000 });
const ms = Date.now() - started;

const precision = {};
for (const row of result.rows) precision[row.occurred_precision] = (precision[row.occurred_precision] || 0) + 1;
const onPeriodEnd = result.rows.filter((row) => /-(12-31|06-30|03-31|09-30)$/.test(row.occurred_at)).length;
const dated = result.rows.filter((row) => row.occurred_precision === "day" || row.occurred_precision === "month");

const summary = {
  company: company.id, kind, url: knownUrl, ms,
  report: { title: result.report.title, published_at: result.report.published_at, pages: result.report.pages,
    text_chars: result.report.text?.length ?? null, section_chars: result.report.section?.length ?? null,
    parse_quality: result.report.parse_quality, visual_pages: result.report.visual_pages?.length ?? 0 },
  returned: result.returned,
  dropped: result.dropped,
  rows: result.rows.length,
  precision,
  on_period_end: onPeriodEnd,
  dated_events: dated.length,
  provider: result.provider,
};
console.log(JSON.stringify(summary, null, 2));
console.log("\n--- 저장 가능 행 (시점 · 정밀도 · 레이어 · 제목) ---");
for (const row of result.rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
  console.log(`${row.occurred_at} ${String(row.occurred_precision).padEnd(5)} ${String(row.layer_key || "-").padEnd(32)} ${row.title_ko}`);
}

mkdirSync("outputs", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = `outputs/probe-digest-${company.id}-${stamp}.json`;
writeFileSync(out, JSON.stringify({ summary, rows: result.rows }, null, 2), "utf8");
console.log(`\n저장: ${out}`);
