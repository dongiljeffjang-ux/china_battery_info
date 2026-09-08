import assert from "node:assert/strict";
import { extractMetricsFromExcerpt, extractMetricsFromEvents, parseAmountCny, periodOf } from "../lib/report-metrics.js";

// 지표 추출은 중문 발췌의 계정 이름만 근거로 삼는다. 아래 발췌는 전부 운영 DB의 실제 값이다.
// 한국어 요약만 보고 매출을 잡으면 CATL 2024·2025년에 해외 매출이 전사 매출 자리에 들어갔다
// (2026-09-08 실측). 그 사고를 고정 케이스로 박아 재발을 막는다.

const pick = (rows, metric) => rows.find((row) => row.metric === metric);
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);

// ── 1. CATL 2023 연차: 전사 매출이 발췌에 있다 ───────────────────────────────
const catl2023 = extractMetricsFromExcerpt(
  "公司实现营业总收入 40,091,704.49 万元，同比增长 22.01%，归属于上市公司股东的净利润 4,412,124.83 万元，同比增长 43.58%。公司实现锂离子电池销量 390GWh，同比增长 34.95%。",
  { evidenceKind: "annual_report", occurredAt: "2023-12-31" },
);
close(pick(catl2023, "revenue_total").value, 4009.170449, "CATL 2023 매출(억 위안)");
assert.equal(pick(catl2023, "revenue_total").line_item_zh, "营业总收入");
assert.equal(pick(catl2023, "revenue_total").yoy_pct_stated, 22.01);
close(pick(catl2023, "net_profit_attr").value, 441.212483, "CATL 2023 지배주주 순이익");
assert.equal(pick(catl2023, "revenue_total").period, "2023");

// ── 2. CATL 2024·2025 연차: 매출 계정이 없다. 해외 매출을 매출로 읽으면 안 된다 ──
const catl2024 = extractMetricsFromExcerpt(
  "实现归属于上市公司股东的净利润 507.45 亿元，同比增长 15.01%。公司实现锂离子电池销量 475GWh，同比增长 21.79%…境外收入 110,335,509 千元，占本期营业收入 30.48%",
  { evidenceKind: "annual_report", occurredAt: "2024-12-31" },
);
assert.equal(pick(catl2024, "revenue_total"), undefined, "해외 매출을 전사 매출로 읽으면 안 된다 (CATL 2024)");
close(pick(catl2024, "overseas_revenue").value, 1103.35509, "CATL 2024 해외 매출");
close(pick(catl2024, "net_profit_attr").value, 507.45, "CATL 2024 지배주주 순이익");

const catl2025 = extractMetricsFromExcerpt(
  "公司境外收入 129,641,258 千元，占本期营业收入 30.60%。海外方面，2025 年公司海外动力电池使用量市占率提升至 30.0%。",
  { evidenceKind: "annual_report", occurredAt: "2025-12-31" },
);
assert.equal(pick(catl2025, "revenue_total"), undefined, "해외 매출을 전사 매출로 읽으면 안 된다 (CATL 2025)");
close(pick(catl2025, "overseas_revenue").value, 1296.41258, "CATL 2025 해외 매출");

// "占本期营业收入 30.48%"처럼 뒤가 %면 값이 아니라 비율이다.
assert.equal(
  pick(extractMetricsFromExcerpt("占本期营业收入 30.48%", { evidenceKind: "annual_report", occurredAt: "2024-12-31" }), "revenue_total"),
  undefined,
  "비율(%)을 금액으로 읽으면 안 된다",
);

// ── 3. 이익 계정 세 가지가 서로를 잡아먹지 않는다 (Zhongke 2025 연차) ──────────
const zhongke = extractMetricsFromExcerpt(
  "2025 年，公司合并财务报表实现营业收入 846,765.46 万元，同比增长 51.72%。归属于上市公司股东的净利润 46,996.57 万元，同比增长 55.09%，归属于上市公司股东的扣除非经常性损益的净利润 43,749.84 万元，同比增长 26.69%。",
  { evidenceKind: "annual_report", occurredAt: "2025-12-31" },
);
close(pick(zhongke, "revenue_total").value, 84.676546, "Zhongke 2025 매출");
close(pick(zhongke, "net_profit_attr").value, 4.699657, "Zhongke 2025 지배주주 순이익");
close(pick(zhongke, "net_profit_excl").value, 4.374984, "Zhongke 2025 扣非 순이익");
assert.equal(pick(zhongke, "net_profit"), undefined, "扣非·귀속 순이익 안의 净利润이 따로 잡히면 안 된다");

// ── 4. 사업부·제품 매출을 전사 매출로 읽지 않는다 (Lopal 2025, Easpring 2025) ──
const lopal = extractMetricsFromExcerpt(
  "其中磷酸铁锂正极材料产品实现营业收入 619,517.70 万元，同比 2024 年增长 10.26%。车用环保精细化学品产品实现营业收入 197,096.79 万元。",
  { evidenceKind: "annual_report", occurredAt: "2025-12-31" },
);
assert.equal(pick(lopal, "revenue_total"), undefined, "제품별 매출을 전사 매출로 읽으면 안 된다");

const easpring = extractMetricsFromExcerpt(
  "2025 年度，当升科技公司的营业收入为人民币 103.74 亿元，其中锂电材料业务的营业收入为人民币 102.00 亿元，占营业收入的 98.32%。",
  { evidenceKind: "annual_report", occurredAt: "2025-12-31" },
);
close(pick(easpring, "revenue_total").value, 103.74, "전사 매출과 사업부 매출이 한 문장에 있으면 전사 값을 택한다");

// ── 5. 귀속 주체를 가르는 "其中"은 사업부 표시가 아니다 (Gotion 2023 연차) ─────
const gotion = extractMetricsFromExcerpt(
  "实现营业收入 3,160,549.00 万元，同比上升 37.11%。实现净利润 96,909.89 万元，同比上升 165.04%，其中，实现归属于母公司所有者的净利润 93,872.68 万元，同比上升 201.28%。",
  { evidenceKind: "annual_report", occurredAt: "2023-12-31" },
);
close(pick(gotion, "revenue_total").value, 316.0549, "Gotion 2023 매출");
close(pick(gotion, "net_profit").value, 9.690989, "Gotion 2023 순이익");
close(pick(gotion, "net_profit_attr").value, 9.387268, "'其中' 뒤의 지배주주 순이익을 버리면 안 된다");

// ── 6. 단위: 亿元·万元·千元·표의 元, 그리고 적자(음수) ───────────────────────
close(parseAmountCny("103.74", "亿元"), 103.74, "亿元");
close(parseAmountCny("846,765.46", "万元"), 84.676546, "万元");
close(parseAmountCny("110,335,509", "千元"), 1103.35509, "千元");
close(parseAmountCny("972,323,295.72", null), 9.7232329572, "단위 없는 표 값은 元으로 읽는다");
assert.equal(parseAmountCny("12", null), null, "단위 없는 작은 수는 금액이 아니다");
assert.equal(parseAmountCny("30.48", "%"), null, "모르는 단위는 버린다");

const zhenhua = extractMetricsFromExcerpt(
  "营业收入 | 972,323,295.72 | 3,258,132,919.34 | -70.16 营业成本 | 1,072,843,822.35 | 3,129,262,564.82 | -65.72",
  { evidenceKind: "periodic_report", occurredAt: "2024-06-30" },
);
close(pick(zhenhua, "revenue_total").value, 9.7232329572, "표 형식 발췌에서 당기 값(첫 칸)을 읽는다");
assert.equal(pick(zhenhua, "revenue_total").period, "2024H1");

const wanrun = extractMetricsFromExcerpt(
  "实现营业总收入 443,589.04 万元，较上年度同比增加 50.49%…实现归属母公司净利润-26,577.81万元，较上年度同比减少亏损 13,861.70 万元",
  { evidenceKind: "periodic_report", occurredAt: "2025-06-30" },
);
close(pick(wanrun, "net_profit_attr").value, -2.657781, "적자는 음수로 읽는다");
assert.equal(pick(wanrun, "revenue_total").yoy_pct_stated, 50.49, "'较上年度同比增加'도 증감률로 읽는다");

const shangtai = extractMetricsFromExcerpt(
  "实现营业收入 450,955.70 万元，较2025 年同期增长 33.11%，实现净利润 39,971.56 万元，较 2025 年同期小幅下降 16.60%",
  { evidenceKind: "periodic_report", occurredAt: "2026-06-30" },
);
assert.equal(pick(shangtai, "revenue_total").yoy_pct_stated, 33.11, "'较2025 年同期增长'도 증감률로 읽는다");

const down = extractMetricsFromExcerpt(
  "实现营业收入 132.97 亿元，同比下降 23.19%。",
  { evidenceKind: "annual_report", occurredAt: "2024-12-31" },
);
assert.equal(pick(down, "revenue_total").yoy_pct_stated, -23.19, "감소는 음수 증감률이다");

// ── 7. 기간 표기 ─────────────────────────────────────────────────────────────
assert.equal(periodOf("annual_report", "2025-12-31"), "2025");
assert.equal(periodOf("periodic_report", "2026-06-30"), "2026H1");
assert.equal(periodOf("periodic_report", "2025-09-30"), "2025Q3");
assert.equal(periodOf("periodic_report", "2025-03-31"), "2025Q1");
assert.equal(periodOf("annual_report", ""), null, "날짜가 없으면 기간을 지어내지 않는다");

// ── 8. 계정을 못 찾으면 값을 만들지 않는다 ───────────────────────────────────
assert.deepEqual(
  extractMetricsFromExcerpt("公司实现锂离子电池销量 390GWh，同比增长 34.95%。", { evidenceKind: "annual_report", occurredAt: "2023-12-31" }),
  [],
  "재무 계정이 없는 발췌에서 금액을 만들면 안 된다",
);
assert.deepEqual(extractMetricsFromExcerpt("", { evidenceKind: "annual_report", occurredAt: "2023-12-31" }), []);
assert.deepEqual(extractMetricsFromExcerpt(null, {}), []);

// 모든 행이 계정 표기를 갖는다 — 화면 규칙(계정 미상이면 표시하지 않는다)의 근거.
for (const rows of [catl2023, catl2024, zhongke, gotion, easpring, zhenhua, wanrun]) {
  for (const row of rows) {
    assert.ok(row.line_item_zh && row.line_item_zh.length > 0, `line_item_zh 없는 행: ${JSON.stringify(row)}`);
    assert.ok(row.quantity_text && row.excerpt.includes(row.quantity_text),
      `원문 표기가 발췌에 글자 그대로 있어야 한다: ${row.quantity_text}`);
  }
}

// ── 9. 같은 칸에 값이 둘이면 연차보고서를 택한다 ─────────────────────────────
const merged = extractMetricsFromEvents([
  { id: "e1", company_id: "acme", evidence_kind: "periodic_report", occurred_at: "2025-12-31", source_url: "u1",
    original_excerpt: "实现营业收入 100.00 亿元。" },
  { id: "e2", company_id: "acme", evidence_kind: "annual_report", occurred_at: "2025-12-31", source_url: "u2",
    original_excerpt: "实现营业总收入 120.00 亿元。" },
]);
const revenue = merged.filter((row) => row.metric === "revenue_total");
assert.equal(revenue.length, 1, "한 회사·기간·지표에 행은 하나다");
close(revenue[0].value, 120, "연차보고서 값을 택한다");
assert.equal(revenue[0].source_url, "u2");

// 기간을 정하지 못한 이벤트는 저장하지 않는다.
assert.deepEqual(
  extractMetricsFromEvents([{ id: "e3", company_id: "acme", evidence_kind: "annual_report", occurred_at: null, original_excerpt: "实现营业收入 100.00 亿元。" }]),
  [],
  "기간을 모르면 시계열에 올리지 않는다",
);

console.log("report metric extraction checks passed");
