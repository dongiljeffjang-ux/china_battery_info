// 과거 기업 시계열 백필 — 로컬 실행용 보조 도구.
//
//   node --env-file=.env scripts/backfill-events.mjs [--since 2023-01-01] [--only catl,byd] [--max 20]
//
// 평소에는 이 스크립트가 필요 없다. 운영 경로는 Vercel의
// POST /api/ingest-rss?backfill=<companyId> 이며, 키는 Vercel 환경변수에만 둔다.
// 이 스크립트는 키를 로컬에 두어야 하므로, 대량 재수집처럼 60초 함수로는
// 감당이 안 되는 일회성 작업에서만 쓴다.
//
// DB에는 쓰지 않고 outputs/backfill/events.json에 후보만 남긴다.

import fs from "node:fs";
import path from "node:path";
import { llmConfig } from "../lib/llm-provider.js";
import { COMPANIES } from "../lib/china-sources.js";
import { backfillCompanyEvents } from "../lib/event-backfill.js";

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

if (!llmConfig("auto")) {
  console.error("LLM 키가 없습니다. 이 스크립트는 로컬 키가 필요합니다. 평소에는 /api/ingest-rss?backfill=<companyId>를 쓰세요.");
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
    const { rows, dropped, returned, provider } = await backfillCompanyEvents({ company, since: SINCE, until: UNTIL, maxEvents: MAX_EVENTS });
    all.push(...rows);
    const drops = Object.entries(dropped).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" ");
    console.log(`${label.padEnd(28)} 채택 ${String(rows.length).padStart(2)} / 응답 ${String(returned).padStart(2)}  ${drops}  (${provider})`);
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
