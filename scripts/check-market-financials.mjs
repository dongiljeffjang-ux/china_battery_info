import assert from "node:assert/strict";
import { periodFromReportDate, securityCodeOf, rowsFromAShare, rowsFromHongKong, dedupeFinancials, SOURCE } from "../lib/market-financials.js";

// 아래 응답 조각은 2026-09-08에 실제 API가 돌려준 값이다. 네트워크 없이 그 형태를 고정한다.
// 이 경로가 필요한 이유: 정기보고서 요약에서 영업이익은 72 회사-연 중 3칸뿐이었다.

const pick = (rows, metric, period) => rows.find((row) => row.metric === metric && row.period === period);
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);

// ── 1. 종목코드 표기 ─────────────────────────────────────────────────────────
assert.deepEqual(securityCodeOf({ cninfo: { codes: ["300750"] } }), { code: "300750.SZ", market: "a" }, "3으로 시작하면 선전");
assert.deepEqual(securityCodeOf({ cninfo: { codes: ["688005"] } }), { code: "688005.SH", market: "a" }, "6으로 시작하면 상하이");
assert.deepEqual(securityCodeOf({ cninfo: { codes: ["002594"] } }), { code: "002594.SZ", market: "a" });
// 북경증권거래소. BTR(贝特瑞 920185)을 .SZ로 붙였다가 이 회사만 응답이 비어 통째로 빠졌다.
assert.deepEqual(securityCodeOf({ cninfo: { codes: ["920185"] } }), { code: "920185.BJ", market: "a" }, "92로 시작하면 북경");
assert.equal(securityCodeOf({ cninfo: { codes: ["430047"] } }).code, "430047.BJ");
assert.equal(securityCodeOf({ cninfo: { codes: ["830799"] } }).code, "830799.BJ");
assert.equal(securityCodeOf({ cninfo: { codes: ["873001"] } }).code, "873001.BJ");
assert.deepEqual(securityCodeOf({ hkex: { code: "03931" } }), { code: "03931.HK", market: "hk" });
assert.equal(securityCodeOf({}), null, "코드가 없으면 대상이 아니다");
// 홍콩·본토 양쪽 코드를 가진 회사는 홍콩을 쓴다(그쪽이 그 회사의 보고 통화·기준이다).
assert.equal(securityCodeOf({ hkex: { code: "00666" }, cninfo: { codes: ["300750"] } }).market, "hk");

// ── 2. 기간 표기 ─────────────────────────────────────────────────────────────
assert.equal(periodFromReportDate("2025-12-31 00:00:00"), "2025");
assert.equal(periodFromReportDate("2026-06-30 00:00:00"), "2026H1");
assert.equal(periodFromReportDate("2025-03-31 00:00:00"), "2025Q1");
assert.equal(periodFromReportDate("2025-09-30 00:00:00"), "2025Q3");
assert.equal(periodFromReportDate("2025-05-31"), null, "결산일이 아닌 날짜는 기간으로 만들지 않는다");
assert.equal(periodFromReportDate(""), null);

// ── 3. A주(CATL 300750) — 영업이익이 실제로 들어온다 ─────────────────────────
const aShare = rowsFromAShare({
  result: { data: [
    { REPORT_DATE: "2025-12-31 00:00:00", TOTAL_OPERATE_INCOME: 423701834000, OPERATE_PROFIT: 89518636000,
      PARENT_NETPROFIT: 72201282000, DEDUCT_PARENT_NETPROFIT: 64507865000, TOTAL_PROFIT: null, OPERATE_COST: null,
      TOI_RATIO: 17.0, OPERATE_PROFIT_RATIO: 39.8, PARENT_NETPROFIT_RATIO: 42.28, DPN_RATIO: 43.4 },
    { REPORT_DATE: "2024-12-31 00:00:00", TOTAL_OPERATE_INCOME: 362012554000, OPERATE_PROFIT: 64051799000,
      PARENT_NETPROFIT: 50744682000, DEDUCT_PARENT_NETPROFIT: 44992919000,
      TOI_RATIO: -9.7, OPERATE_PROFIT_RATIO: 22.5, PARENT_NETPROFIT_RATIO: 15.01, DPN_RATIO: 12.2 },
    { REPORT_DATE: "2025-05-31 00:00:00", TOTAL_OPERATE_INCOME: 1, OPERATE_PROFIT: 1, PARENT_NETPROFIT: 1, DEDUCT_PARENT_NETPROFIT: 1 },
  ] },
}, { companyId: "catl", securityCode: "300750.SZ" });

close(pick(aShare, "revenue_total", "2025").value, 4237.01834, "CATL 2025 매출(억 위안)");
close(pick(aShare, "operating_profit", "2025").value, 895.18636, "CATL 2025 영업이익");
close(pick(aShare, "net_profit_attr", "2025").value, 722.01282, "CATL 2025 지배주주 순이익");
close(pick(aShare, "net_profit_excl", "2025").value, 645.07865, "CATL 2025 扣非 순이익");
assert.equal(pick(aShare, "operating_profit", "2025").item_zh, "营业利润");
assert.equal(pick(aShare, "net_profit_attr", "2025").yoy_pct, 42.28, "제공자가 준 전년비를 그대로 싣는다");
assert.equal(pick(aShare, "revenue_total", "2025").currency, "CNY");
assert.equal(pick(aShare, "revenue_total", "2025").source, SOURCE);
// 원값을 남겨 환산을 검산할 수 있어야 한다.
close(pick(aShare, "revenue_total", "2025").raw_amount / 1e8, pick(aShare, "revenue_total", "2025").value, "raw_amount와 value가 일치");
// 결산일이 아닌 행은 통째로 버린다.
assert.equal(aShare.filter((row) => row.report_date === "2025-05-31").length, 0, "결산일이 아닌 행은 담지 않는다");
// 값이 null인 항목은 행을 만들지 않는다.
assert.equal(pick(aShare, "total_profit", "2025"), undefined, "null 항목은 행을 만들지 않는다");

// 우리가 보고서 발췌에서 뽑아 둔 값과 같아야 한다(교차검증). CATL 2025 귀속순이익 722.01억.
close(pick(aShare, "net_profit_attr", "2025").value, 722.01282, "보고서 발췌값(722억)과 일치");

// ── 4. 홍콩(CALB 03931) — 롱 포맷에서 표준 항목만 고른다 ─────────────────────
const hk = rowsFromHongKong({
  result: { data: [
    { REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004001999", ITEM_NAME: "营运收入", AMOUNT: 44400067000, YOY_RATIO: 59.99, CURRENCY: "人民币", REPORT_TYPE: "年报", ACCOUNT_STANDARD: "国际会计准则" },
    { REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004010999", ITEM_NAME: "经营溢利", AMOUNT: 3125766000, YOY_RATIO: 159.31, CURRENCY: "人民币", REPORT_TYPE: "年报", ACCOUNT_STANDARD: "国际会计准则" },
    { REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004025002", ITEM_NAME: "股东应占溢利", AMOUNT: 1475632000, YOY_RATIO: 149.60, CURRENCY: "人民币", REPORT_TYPE: "年报", ACCOUNT_STANDARD: "国际会计准则" },
    { REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004011201", ITEM_NAME: "融资成本", AMOUNT: 854596000, YOY_RATIO: 105.87, CURRENCY: "人民币", REPORT_TYPE: "年报" },
    { REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004027002", ITEM_NAME: "每股基本盈利", AMOUNT: 0.8326, YOY_RATIO: 149.58, CURRENCY: "人民币", REPORT_TYPE: "年报" },
  ] },
}, { companyId: "calb", securityCode: "03931.HK" });

close(pick(hk, "revenue_total", "2025").value, 444.00067, "CALB 2025 매출");
close(pick(hk, "operating_profit", "2025").value, 31.25766, "CALB 2025 영업이익(经营溢利)");
close(pick(hk, "net_profit_attr", "2025").value, 14.75632, "CALB 2025 주주귀속 이익");
assert.equal(pick(hk, "revenue_total", "2025").account_standard, "国际会计准则", "회계기준을 남긴다");
assert.equal(pick(hk, "revenue_total", "2025").currency, "CNY", "人民币는 CNY로 표기한다");
assert.equal(hk.length, 3, "사전에 없는 항목(융자비용·주당순이익)은 담지 않는다");

// 통화가 다르면 그대로 남긴다. 환산하지 않는다.
const hkd = rowsFromHongKong({
  result: { data: [{ REPORT_DATE: "2025-12-31 00:00:00", STD_ITEM_CODE: "004001999", AMOUNT: 1e9, CURRENCY: "港元" }] },
}, { companyId: "x", securityCode: "00666.HK" });
assert.equal(hkd[0].currency, "HKD", "홍콩달러 보고는 그대로 HKD로 남긴다");

// ── 5. 같은 칸이 겹치면 최신 결산 행을 남긴다(정정 공시) ─────────────────────
const deduped = dedupeFinancials([
  { company_id: "c", period: "2025", metric: "revenue_total", value: 100, report_date: "2026-01-31" },
  { company_id: "c", period: "2025", metric: "revenue_total", value: 120, report_date: "2026-04-30" },
  { company_id: "c", period: "2025", metric: "operating_profit", value: 10, report_date: "2026-04-30" },
]);
assert.equal(deduped.length, 2, "한 회사·기간·지표에 행은 하나다");
assert.equal(deduped.find((row) => row.metric === "revenue_total").value, 120, "나중 결산 행을 택한다");

// ── 6. 빈 응답에서 값을 만들지 않는다 ───────────────────────────────────────
assert.deepEqual(rowsFromAShare({}, { companyId: "c", securityCode: "x" }), []);
assert.deepEqual(rowsFromAShare({ result: { data: [] } }, { companyId: "c", securityCode: "x" }), []);
assert.deepEqual(rowsFromHongKong(null, { companyId: "c", securityCode: "x" }), []);

console.log("market financial checks passed");
