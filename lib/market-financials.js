// 거래소 상장사의 표준 손익 항목을 데이터 제공자 API에서 받아 시계열로 만든다. LLM을 쓰지 않는다.
//
// 왜 필요한가. 정기보고서 요약에서 뽑은 값(report_metric)은 원문 발췌를 갖지만, 요약이 고른 항목만
// 남는다. 2026-09-08 실측에서 영업이익은 72 회사-연 중 3칸, 扣非 순이익은 4칸뿐이었다. 사용자가
// 가장 중요하다고 한 영업이익이 사실상 비어 있었다. 원문 PDF를 다시 읽어 LLM으로 뽑는 길도 있으나,
// 상장사 손익 항목은 이미 표준화된 표로 공개돼 있어 그 길이 더 싸고 정확하다(외부 LLM 호출 0회).
//
// 한계도 분명하다. 이 값에는 원문 발췌가 없다. 그래서 report_metric을 대체하지 않고 병존시키며,
// 두 출처가 같은 칸을 채우면 서로 검증이 된다(CATL 2025 귀속순이익 722.01억이 양쪽에서 일치).
// 출하량·생산능력은 손익계산서 항목이 아니라 여기서 오지 않는다. 그것은 보고서 텍스트 경로로 남는다.

const A_SHARE_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const HK_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get";
const UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)";
export const SOURCE = "eastmoney:income_statement";
// 금액은 元로 온다. 화면과 report_metric이 쓰는 억 위안으로 맞춘다.
const YUAN_PER_100M = 1e8;

// A주 응답은 한 행에 모든 항목이 열로 온다. 열 이름 → 우리 metric 키와 원문 계정 표기.
const A_SHARE_FIELDS = [
  { metric: "revenue_total", column: "TOTAL_OPERATE_INCOME", item_zh: "营业总收入", yoy: "TOI_RATIO" },
  { metric: "operating_profit", column: "OPERATE_PROFIT", item_zh: "营业利润", yoy: "OPERATE_PROFIT_RATIO" },
  { metric: "net_profit_attr", column: "PARENT_NETPROFIT", item_zh: "归属于母公司股东的净利润", yoy: "PARENT_NETPROFIT_RATIO" },
  { metric: "net_profit_excl", column: "DEDUCT_PARENT_NETPROFIT", item_zh: "扣除非经常性损益的归母净利润", yoy: "DPN_RATIO" },
  { metric: "total_profit", column: "TOTAL_PROFIT", item_zh: "利润总额", yoy: null },
  { metric: "operating_cost", column: "OPERATE_COST", item_zh: "营业成本", yoy: null },
  { metric: "rnd_expense", column: "RESEARCH_EXPENSE", item_zh: "研发费用", yoy: null },
];
// 홍콩 응답은 한 행에 한 항목씩 온다(롱 포맷). 표준 항목 코드로 고른다.
const HK_ITEMS = {
  "004001999": { metric: "revenue_total", item_zh: "营运收入" },
  "004010999": { metric: "operating_profit", item_zh: "经营溢利" },
  "004025002": { metric: "net_profit_attr", item_zh: "股东应占溢利" },
  "004007999": { metric: "gross_profit", item_zh: "毛利" },
  "004010010": { metric: "rnd_expense", item_zh: "研发费用" },
  "004012999": { metric: "net_profit", item_zh: "除税后溢利" },
};
const CURRENCY_CODES = { "人民币": "CNY", "港元": "HKD", "美元": "USD" };

// 결산일 → 기간 표기. 손익은 누적 공시라 3·6·9월은 그 시점까지의 누적이다.
export function periodFromReportDate(reportDate) {
  const match = String(reportDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month] = match;
  if (month === "12") return year;
  if (month === "06") return `${year}H1`;
  if (month === "03") return `${year}Q1`;
  if (month === "09") return `${year}Q3`;
  return null;
}

// null·빈 문자열을 Number()에 그냥 넘기면 0이 된다. 없는 항목이 0으로 저장되면 차트에
// "그 해 영업이익이 0이었다"는 없는 사실이 그려진다. 값이 없으면 행을 만들지 않는다.
function toHundredMillion(amount) {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? value / YUAN_PER_100M : null;
}

// 회사 마스터의 종목코드를 제공자 표기로 바꾼다. 코드가 없으면 이 회사는 대상이 아니다.
export function securityCodeOf(company) {
  if (company?.hkex?.code) return { code: `${company.hkex.code}.HK`, market: "hk" };
  const code = company?.cninfo?.codes?.[0];
  if (!code) return null;
  // 6xx는 상하이. 북경증권거래소는 92·43·83·87로 시작하고 접미사가 따로 있다 —
  // BTR(贝特瑞 920185)을 .SZ로 붙였다가 "返回数据为空"으로 이 회사만 통째로 빠졌다.
  // 나머지 0·2·3은 선전이다.
  const suffix = code.startsWith("6") ? "SH" : /^(92|43|83|87)/.test(code) ? "BJ" : "SZ";
  return { code: `${code}.${suffix}`, market: "a" };
}

export function rowsFromAShare(payload, { companyId, securityCode }) {
  const rows = [];
  for (const item of payload?.result?.data || []) {
    const period = periodFromReportDate(item.REPORT_DATE);
    if (!period) continue;
    for (const field of A_SHARE_FIELDS) {
      const value = toHundredMillion(item[field.column]);
      if (value === null) continue;
      const yoy = field.yoy === null ? null : Number(item[field.yoy]);
      rows.push({
        company_id: companyId, security_code: securityCode, period,
        report_date: String(item.REPORT_DATE).slice(0, 10),
        metric: field.metric, item_zh: field.item_zh,
        value, unit: "CNY_100M", currency: "CNY",
        raw_amount: Number(item[field.column]),
        yoy_pct: Number.isFinite(yoy) ? yoy : null,
        report_type: null, account_standard: null, source: SOURCE,
      });
    }
  }
  return rows;
}

export function rowsFromHongKong(payload, { companyId, securityCode }) {
  const rows = [];
  for (const item of payload?.result?.data || []) {
    const spec = HK_ITEMS[item.STD_ITEM_CODE];
    if (!spec) continue;
    const period = periodFromReportDate(item.REPORT_DATE);
    if (!period) continue;
    const value = toHundredMillion(item.AMOUNT);
    if (value === null) continue;
    const yoy = Number(item.YOY_RATIO);
    rows.push({
      company_id: companyId, security_code: securityCode, period,
      report_date: String(item.REPORT_DATE).slice(0, 10),
      metric: spec.metric, item_zh: spec.item_zh,
      value, unit: "CNY_100M",
      currency: CURRENCY_CODES[item.CURRENCY] || item.CURRENCY_CODE || "CNY",
      raw_amount: Number(item.AMOUNT),
      yoy_pct: Number.isFinite(yoy) ? yoy : null,
      report_type: item.REPORT_TYPE || null,
      account_standard: item.ACCOUNT_STANDARD || null,
      source: SOURCE,
    });
  }
  return rows;
}

// 같은 칸(회사·기간·지표)에 값이 둘이면 최신 결산 행을 남긴다. 정정 공시가 뒤에 오기 때문이다.
export function dedupeFinancials(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = `${row.company_id} ${row.period} ${row.metric}`;
    const kept = best.get(key);
    if (!kept || row.report_date > kept.report_date) best.set(key, row);
  }
  return [...best.values()];
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json();
  if (payload && payload.success === false) throw new Error(`API_${payload.code}: ${payload.message}`);
  return payload;
}

// 회사 하나의 손익 시계열을 받는다. 요청은 회사당 1회다.
export async function fetchCompanyFinancials(company, { pageSize = 60, timeoutMs = 20000 } = {}) {
  const security = securityCodeOf(company);
  if (!security) return { rows: [], skipped: "no_security_code" };
  const filter = `(SECUCODE="${security.code}")`;
  if (security.market === "hk") {
    const url = `${HK_URL}?reportName=RPT_HKF10_FN_INCOME&columns=SECUCODE,REPORT_DATE,STD_ITEM_CODE,ITEM_NAME,AMOUNT,YOY_RATIO,CURRENCY,CURRENCY_CODE,ACCOUNT_STANDARD,REPORT_TYPE&filter=${encodeURIComponent(filter)}&pageSize=${pageSize * 6}&sortColumns=REPORT_DATE&sortTypes=-1`;
    const payload = await fetchJson(url, timeoutMs);
    return { rows: dedupeFinancials(rowsFromHongKong(payload, { companyId: company.id, securityCode: security.code })) };
  }
  const url = `${A_SHARE_URL}?reportName=RPT_DMSK_FN_INCOME&columns=ALL&filter=${encodeURIComponent(filter)}&pageSize=${pageSize}&sortColumns=REPORT_DATE&sortTypes=-1`;
  const payload = await fetchJson(url, timeoutMs);
  return { rows: dedupeFinancials(rowsFromAShare(payload, { companyId: company.id, securityCode: security.code })) };
}
