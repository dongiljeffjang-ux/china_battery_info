// 정량 질문의 구조화 사전조회. "CATL의 2025년 매출은?"처럼 회사·지표·기간을 짚은 질문은
// 임베딩이나 단어 검색이 아니라 report_metric·market_financial을 SELECT해서 답한다. LLM 0회.
//
// 왜 필요한가(2026-09-09 실측). 정답 청크 "[사실] 2025년 매출 4,237억 위안"이 코퍼스에 있는데도
// 검색이 못 꺼냈다. 단어 검색은 낱말 등장 횟수를 세므로 104자짜리 정답(7점)이 긴 2026년 기사(41점)에
// 항상 진다. 의미 검색은 연도를 거의 구분하지 못한다(2023~2026년 매출 사실들이 유사도 0.80~0.89에
// 뒤섞임). 둘 다 구조상의 한계라 검색어를 손봐도 안 고쳐진다. 반면 같은 값이 report_metric과
// market_financial에 구조화돼 있고, 그래프는 이미 그것을 그린다. 그 테이블을 먼저 보면 된다.
//
// 원칙
// - 회사와 지표가 둘 다 잡혀야 발동한다. 하나만 잡히면 일반 검색에 맡긴다.
// - report_metric(원문 발췌 있음)을 먼저 쓰고, 그 칸이 비었을 때만 market_financial(거래소 집계,
//   발췌 없음)로 채운다. 발췌 없는 행은 등급을 밝힌다. 사용자 결정(계획서 U4, 2026-09-09).
// - 파생 계산(이익률·CAGR·합계)은 하지 않는다. 저장된 증감률만 그대로 낸다.
// - 여기서 만든 행은 knowledge_chunk와 같은 모양의 가짜 청크로 검색 결과 앞에 붙는다. 답변 프롬프트와
//   화면은 source_type='metric_row'로 구분한다.

import { COMPANIES } from "./china-sources.js";

// 질문 표현 → 저장된 metric 키. 긴 표현이 먼저 와야 한다 — "해외 매출"이 "매출"로 잡히면 안 된다.
// keys: 그 키들. prefix: 그 접두어로 시작하는 키 전부(출하량·생산능력은 품목별로 갈라져 있다).
const METRIC_PATTERNS = [
  { keys: ["overseas_revenue"], patterns: [/해외\s*매출/, /해외\s*수익/, /overseas revenue/i, /境外收入/, /海外收入/] },
  { keys: ["net_profit_excl"], patterns: [/비경상/, /扣非/, /扣除非经常/, /non-recurring/i] },
  { keys: ["net_profit_attr"], patterns: [/지배주주\s*순이익/, /지배주주/, /귀속\s*순이익/, /모회사\s*순이익/, /归母/, /归属于/, /attributable/i] },
  { keys: ["net_profit_attr", "net_profit"], patterns: [/순이익/, /당기\s*순이익/, /net (profit|income)/i, /净利润/, /净利/, /溢利/] },
  { keys: ["operating_profit"], patterns: [/영업\s*이익/, /operating (profit|income)/i, /营业利润/, /经营溢利/] },
  { keys: ["total_profit"], patterns: [/세전\s*이익/, /이익\s*총액/, /利润总额/, /pre-?tax/i] },
  { keys: ["gross_profit"], patterns: [/매출\s*총이익/, /gross profit/i, /毛利(?!率)/] },
  { keys: ["operating_cost"], patterns: [/매출\s*원가/, /영업\s*원가/, /operating cost/i, /营业成本/] },
  { keys: ["rnd_expense"], patterns: [/연구\s*개발\s*비/, /R&D/i, /研发费用/, /研发投入/] },
  { keys: ["ocf"], patterns: [/영업\s*(활동\s*)?현금\s*흐름/, /operating cash ?flow/i, /经营活动.*现金/] },
  { keys: ["revenue_total"], patterns: [/매출/, /영업\s*수익/, /영업\s*수입/, /revenue/i, /(^|[^a-z])sales([^a-z]|$)/i, /营业(总)?收入/, /营收/, /营运收入/] },
  { prefix: "shipment_", patterns: [/출하량?/, /판매량/, /shipments?/i, /sales volume/i, /出货量/, /销量/] },
  { prefix: "installed_", patterns: [/장착량?/, /탑재량/, /installed/i, /装机量/, /装车量/] },
  { prefix: "capacity_", patterns: [/생산\s*능력/, /캐파/, /capacity/i, /产能/] },
];

const PERIOD_LABEL = { H1: "상반기", H2: "하반기", Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기" };
const PERIOD_END = { "": "12-31", H1: "06-30", H2: "12-31", Q1: "03-31", Q2: "06-30", Q3: "09-30", Q4: "12-31" };
const UNIT_LABEL = { CNY_100M: "억 위안", GWh: "GWh", t: "톤", MWh: "MWh" };

function containsTerm(lower, term) {
  const needle = String(term || "").toLowerCase().trim();
  if (!needle) return false;
  if (/^[a-z0-9][a-z0-9 .&+\-]*$/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(lower);
  }
  return lower.includes(needle);
}

function companyTerms(company) {
  return [company.id, company.name_ko, String(company.name_ko || "").replace(/\([^)]*\)/g, "").trim(),
    company.name_zh, company.name_en, ...(company.aliases || [])].filter((term) => term && term.length >= 2);
}

// 질문에 이름이 나온 회사. 여러 회사가 나오면 전부 돌려준다(비교 질문). 없으면 빈 배열.
export function matchCompanies(question, companies = COMPANIES) {
  const lower = String(question || "").toLowerCase();
  return companies.filter((company) => companyTerms(company).some((term) => containsTerm(lower, term))).map((company) => company.id);
}

// 질문이 가리키는 지표 키. exact 키 목록과 prefix 목록을 나눠 돌려준다.
export function matchMetrics(question) {
  const keys = new Set();
  const prefixes = new Set();
  let consumed = String(question || "");
  for (const entry of METRIC_PATTERNS) {
    const hit = entry.patterns.find((pattern) => pattern.test(consumed));
    if (!hit) continue;
    if (entry.keys) entry.keys.forEach((key) => keys.add(key));
    if (entry.prefix) prefixes.add(entry.prefix);
    // 긴 표현이 잡힌 자리를 지워 짧은 표현이 같은 글자를 다시 잡지 못하게 한다.
    consumed = consumed.replace(hit, " ");
  }
  return { keys: [...keys], prefixes: [...prefixes] };
}

// 기간. "2025년", "2024년 상반기", "2023Q3", "2023~2025", "2023년부터 2025년까지", "최근 3년".
// 비어 있으면 기간 제한 없음(호출자가 최신순 상한을 건다).
export function matchPeriods(question, { now = new Date() } = {}) {
  const text = String(question || "");
  const periods = new Set();
  const range = text.match(/(20\d{2})\s*년?\s*(?:~|-|–|부터)\s*(20\d{2})\s*년?/);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (to >= from && to - from <= 10) for (let year = from; year <= to; year += 1) periods.add(String(year));
  }
  const recent = text.match(/최근\s*(\d{1,2})\s*(년|개년)/);
  if (recent) {
    const count = Math.min(Number(recent[1]), 10);
    const thisYear = now.getFullYear();
    // 올해는 아직 연간이 없으므로 지난해부터 센다.
    for (let i = 1; i <= count; i += 1) periods.add(String(thisYear - i));
  }
  const single = /(20\d{2})\s*년?\s*(상반기|하반기|1분기|2분기|3분기|4분기|H[12]|Q[1-4])?/g;
  for (const match of text.matchAll(single)) {
    const year = match[1];
    const raw = match[2] || "";
    const sub = raw === "상반기" ? "H1" : raw === "하반기" ? "H2" : /분기$/.test(raw) ? `Q${raw[0]}` : raw.toUpperCase();
    periods.add(`${year}${sub}`);
  }
  return [...periods].sort();
}

// 발동 조건: 회사와 지표가 모두 잡혀야 한다.
export function parseMetricQuestion(question, options = {}) {
  const companies = matchCompanies(question, options.companies);
  const metrics = matchMetrics(question);
  if (!companies.length || (!metrics.keys.length && !metrics.prefixes.length)) return null;
  return { companies, metrics, periods: matchPeriods(question, options) };
}

function companyName(companyId) {
  return COMPANIES.find((company) => company.id === companyId)?.name_ko || companyId;
}

function periodLabel(period) {
  const [, year, sub = ""] = String(period).match(/^(\d{4})(H[12]|Q[1-4])?$/) || [];
  if (!year) return String(period);
  return sub ? `${year}년 ${PERIOD_LABEL[sub]}` : `${year}년`;
}

function periodEndDate(period) {
  const [, year, sub = ""] = String(period).match(/^(\d{4})(H[12]|Q[1-4])?$/) || [];
  return year ? `${year}-${PERIOD_END[sub]}` : null;
}

function formatValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const label = UNIT_LABEL[unit] || unit || "";
  const text = Math.abs(number) >= 100 ? number.toLocaleString("ko-KR", { maximumFractionDigits: 1 })
    : number.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return `${text}${label === "GWh" || label === "MWh" ? " " : ""}${label}`;
}

function yoyText(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return "";
  const number = Number(pct);
  return `, 전년 대비 ${number > 0 ? "+" : ""}${number.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

const METRIC_KO = {
  revenue_total: "매출", overseas_revenue: "해외 매출", operating_profit: "영업이익", total_profit: "세전이익",
  net_profit_attr: "지배주주 순이익", net_profit: "순이익", net_profit_excl: "순이익(비경상 제외)",
  gross_profit: "매출총이익", operating_cost: "매출원가", rnd_expense: "연구개발비", ocf: "영업활동 현금흐름",
};

function metricKo(metric) {
  if (METRIC_KO[metric]) return METRIC_KO[metric];
  const [, kind, item] = String(metric).match(/^(shipment|installed|capacity)(?:_plan|_cum)?_(.+)$/) || [];
  const kindKo = { shipment: "출하량", installed: "장착량", capacity: "생산능력" }[kind];
  if (!kindKo) return metric;
  const plan = /_plan_/.test(metric) ? "계획 " : /_cum_/.test(metric) ? "누적 " : "";
  return `${item.replace(/_/g, " ")} ${plan}${kindKo}`;
}

// report_metric 행 → 가짜 청크. 원문 발췌와 PDF 링크가 있으므로 정식 근거 등급이다.
export function chunkFromReportMetric(row) {
  const company = companyName(row.company_id);
  const label = periodLabel(row.period);
  const report = row.report_kind === "annual_report" ? "연차보고서" : "정기보고서";
  return {
    id: `metric:report:${row.company_id}:${row.period}:${row.metric}`,
    source_type: "metric_row",
    metric_grade: "excerpt",
    company_id: row.company_id,
    published_at: row.occurred_at || periodEndDate(row.period),
    source_name: `${report} ${label} 정량 항목`,
    source_url: row.source_url || null,
    content_ko: `[회사] ${company}\n[시점] ${label}\n[구분] 정량 · 보고서 발췌\n[사실] ${company} ${label} ${metricKo(row.metric)} ${formatValue(row.value, row.unit)}${yoyText(row.yoy_pct_stated)} (원문 계정 ${row.line_item_zh}, 표기 "${String(row.quantity_text || "").trim()}")`,
    original_excerpt: row.excerpt || "",
    similarity: null,
  };
}

// market_financial 행 → 가짜 청크. 원문 발췌가 없으므로 등급을 본문과 출처명에 모두 박는다.
export function chunkFromMarketFinancial(row) {
  const company = companyName(row.company_id);
  const label = periodLabel(row.period);
  return {
    id: `metric:market:${row.company_id}:${row.period}:${row.metric}`,
    source_type: "metric_row",
    metric_grade: "provider",
    company_id: row.company_id,
    published_at: row.report_date || periodEndDate(row.period),
    source_name: `거래소 손익 데이터(${String(row.source || "").split(":")[0] || "제공자"}) · 원문 발췌 없음`,
    source_url: null,
    content_ko: `[회사] ${company}\n[시점] ${label}\n[구분] 정량 · 제공자 집계값 · 원문 발췌 없음\n[사실] ${company} ${label} ${metricKo(row.metric)} ${formatValue(row.value, row.unit)}${yoyText(row.yoy_pct)} (제공자 항목 ${row.item_zh}${row.currency && row.currency !== "CNY" ? `, 통화 ${row.currency}` : ""})`,
    original_excerpt: "",
    similarity: null,
  };
}

// 두 출처를 칸 단위로 합친다. report_metric이 있는 칸은 market_financial을 넣지 않는다.
// 같은 칸을 두 번 내면 답변이 "상충"으로 오해한다.
export function mergeMetricRows(reportRows, marketRows, { limit = 6 } = {}) {
  const cells = new Map();
  for (const row of reportRows || []) cells.set(`${row.company_id}|${row.period}|${row.metric}`, chunkFromReportMetric(row));
  for (const row of marketRows || []) {
    const key = `${row.company_id}|${row.period}|${row.metric}`;
    if (!cells.has(key)) cells.set(key, chunkFromMarketFinancial(row));
  }
  // 기간 최신순, 같은 기간이면 지표 이름순. 상한은 호출자가 프롬프트 여유에 맞춰 준다.
  return [...cells.values()]
    .sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// PostgREST 필터. 키 목록과 접두어를 or()로 묶는다.
export function metricFilter(metrics) {
  const parts = [];
  if (metrics.keys.length) parts.push(`metric.in.(${metrics.keys.join(",")})`);
  for (const prefix of metrics.prefixes) parts.push(`metric.like.${prefix}*`);
  return parts.length === 1 ? parts[0].replace(/^metric\./, "metric=") : `or=(${parts.join(",")})`;
}

// 실제 조회. supabaseRest를 주입받아 회귀에서 가짜로 바꿀 수 있게 한다.
export async function lookupMetrics(parsed, { supabaseRest, limit = 6 } = {}) {
  if (!parsed || !supabaseRest) return [];
  const company = `company_id=in.(${parsed.companies.join(",")})`;
  const period = parsed.periods.length ? `&period=in.(${parsed.periods.join(",")})` : "";
  const query = `${company}&${metricFilter(parsed.metrics)}${period}`;
  const [reportRows, marketRows] = await Promise.all([
    supabaseRest(`report_metric?select=company_id,period,metric,value,unit,line_item_zh,quantity_text,yoy_pct_stated,excerpt,report_kind,source_url,occurred_at&${query}&order=period.desc&limit=40`).catch(() => []),
    supabaseRest(`market_financial?select=company_id,period,metric,value,unit,currency,item_zh,yoy_pct,report_date,source&${query}&order=period.desc&limit=40`).catch(() => []),
  ]);
  return mergeMetricRows(reportRows, marketRows, { limit });
}
