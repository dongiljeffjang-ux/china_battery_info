// report_metric(공시 PDF 추출)과 market_financial(거래소 데이터)을 같은 칸에서 대조한다.
//
//   node --env-file=.env scripts/crosscheck-report-metrics.mjs
//   node --env-file=.env scripts/crosscheck-report-metrics.mjs --tolerance 0.02
//
// 읽기만 한다. DB에 쓰지 않는다. LLM을 쓰지 않는다.
//
// 왜 필요한가. 두 테이블은 서로 다른 경로로 만들어진다 — report_metric은 보고서 중문 발췌를
// 코드가 파싱한 것이고, market_financial은 거래소 재무 데이터다. 같은 칸의 값이 어긋나면
// 둘 중 하나가 틀린 것이고, 대개는 추출 쪽이다. 2026-09-09 최초 실행에서 145칸 중 141칸이
// 소수점까지 일치했고 어긋난 4칸은 전부 계정 오선택(자회사·제품 매출을 전사 매출로)이었다.
// 단위 오류는 비율이 1000·0.001로 튀므로 이 대조 한 번이면 잡힌다.
//
// 이 스크립트는 `check-*.mjs` 회귀가 아니다. 운영 DB 읽기가 필요하므로 이름을 다르게 둔다.

import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";

const args = process.argv.slice(2);
const tolIndex = args.indexOf("--tolerance");
// 기본 1%. 보고서는 반올림해 적고 거래소는 원값이라 이 정도 차이는 정상이다.
const TOLERANCE = tolIndex >= 0 ? Number(args[tolIndex + 1]) : 0.01;
const YEARS = ["2023", "2024", "2025"];
const PAGE = 1000;

if (!hasDatabaseConfig()) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없다. --env-file=.env로 실행한다.");
  process.exit(1);
}

async function fetchAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabaseRest(`${path}&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

const [metrics, financials] = await Promise.all([
  fetchAll("report_metric?select=company_id,period,metric,value,unit,line_item_zh,quantity_text,excerpt&unit=eq.CNY_100M&order=company_id.asc"),
  fetchAll("market_financial?select=company_id,period,metric,value,unit&unit=eq.CNY_100M&order=company_id.asc"),
]);

const key = (row) => `${row.company_id}\t${row.period}\t${row.metric}`;
const market = new Map(financials.map((row) => [key(row), Number(row.value)]));

const off = [];
let matched = 0;
for (const row of metrics) {
  const reference = market.get(key(row));
  if (reference === undefined || !Number.isFinite(reference) || reference === 0) continue;
  const value = Number(row.value);
  const ratio = value / reference;
  if (Math.abs(ratio - 1) <= TOLERANCE) { matched += 1; continue; }
  off.push({ ...row, reference, ratio });
}

console.log(`대조 가능한 칸 ${matched + off.length} (report_metric ${metrics.length}행 · market_financial ${financials.length}행)`);
console.log(`  일치(±${(TOLERANCE * 100).toFixed(0)}%) ${matched}`);
console.log(`  이탈           ${off.length}`);

if (off.length) {
  // 단위 오류는 비율이 10배 이상 벌어진다. 계정 오선택과 나눠 봐야 원인이 갈린다.
  const scale = off.filter((row) => row.ratio >= 10 || row.ratio <= 0.1);
  const account = off.filter((row) => !(row.ratio >= 10 || row.ratio <= 0.1));
  if (scale.length) {
    console.log(`\n[단위 의심] 비율이 10배 이상 벌어진 ${scale.length}건 — 万元/千元/亿元 환산을 먼저 본다.`);
    for (const row of scale.sort((a, b) => a.ratio - b.ratio)) {
      console.log(`  ${row.company_id} ${row.period} ${row.metric}: 추출 ${row.value} vs 거래소 ${row.reference} (×${row.ratio.toExponential(2)})`);
      console.log(`      표기 "${row.quantity_text}" 계정 ${row.line_item_zh}`);
    }
  }
  if (account.length) {
    console.log(`\n[계정 의심] ${account.length}건 — 자회사·제품·사업부 값을 전사 값으로 잡았는지 발췌를 본다.`);
    for (const row of account.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1)).reverse()) {
      console.log(`  ${row.company_id} ${row.period} ${row.metric}: 추출 ${row.value} vs 거래소 ${row.reference} (비율 ${row.ratio.toFixed(4)})`);
      console.log(`      계정 ${row.line_item_zh} · 표기 "${row.quantity_text}"`);
      console.log(`      발췌 ${String(row.excerpt || "").slice(0, 120)}`);
    }
  }
}

// 대조는 "들어간 값이 맞는가"만 잰다. 빠진 칸은 비교 대상이 아니므로 따로 센다.
const companies = [...new Set(metrics.map((row) => row.company_id))].sort();
const filled = new Set(metrics.filter((row) => row.metric === "revenue_total").map((row) => `${row.company_id} ${row.period}`));
const missing = [];
for (const company of companies) for (const year of YEARS) if (!filled.has(`${company} ${year}`)) missing.push(`${company} ${year}`);

console.log(`\n연간 매출 커버리지: ${companies.length * YEARS.length - missing.length} / ${companies.length * YEARS.length}칸 (회사 ${companies.length}사 × ${YEARS.length}년)`);
if (missing.length) console.log(`  빈 칸 ${missing.length}: ${missing.join(", ")}`);

process.exit(off.length ? 1 : 0);
