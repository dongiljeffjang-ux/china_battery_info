// 정량 사전조회(T4)의 회귀. 네트워크·API 호출 없음.
//
// 2026-09-09: "CATL의 2025년 매출은?"의 정답 청크가 코퍼스에 있는데도 단어·의미 검색 둘 다 10위 밖이었다.
// 회사·지표를 짚은 질문은 report_metric·market_financial을 SELECT해 근거 앞에 붙인다. 이 검사는
// (1) 질문 파싱 표, (2) 발동 조건, (3) 발췌 없는 행의 등급 라벨, (4) 같은 칸 중복 제거, (5) 프롬프트와
// 화면이 등급을 실제로 다루는지 본다.
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.OPENAI_API_KEY = "test-only";
const m = await import("../lib/metric-lookup.js");
const NOW = new Date("2026-09-09T00:00:00Z");

// (1) 질문 파싱 표. 회사 × 지표 × 기간.
const table = [
  ["CATL의 2025년 매출은?", ["catl"], ["revenue_total"], [], ["2025"]],
  ["CATL의 2023년부터 2025년까지 매출은?", ["catl"], ["revenue_total"], [], ["2023", "2024", "2025"]],
  ["BYD의 2023년부터의 연도별 매출", ["byd"], ["revenue_total"], [], ["2023", "2024", "2025"]],
  ["BYD의 2023년 이후 연도별 매출", ["byd"], ["revenue_total"], [], ["2023", "2024", "2025"]],
  ["CATL 2023~2025 매출", ["catl"], ["revenue_total"], [], ["2023", "2024", "2025"]],
  ["후난위넝 2024년 상반기 영업이익", ["hunan-yuneng"], ["operating_profit"], [], ["2024H1"]],
  ["이브에너지 최근 3년 순이익", ["eve-energy"], ["net_profit_attr", "net_profit"], [], ["2023", "2024", "2025"]],
  ["CATL 2024 지배주주 순이익", ["catl"], ["net_profit_attr"], [], ["2024"]],
  ["CATL 2024년 비경상 제외 순이익", ["catl"], ["net_profit_excl", "net_profit_attr", "net_profit"], [], ["2024"]],
  ["CATL 해외 매출 2025", ["catl"], ["overseas_revenue"], [], ["2025"]],
  ["宁德时代 2025年 营业收入", ["catl"], ["revenue_total"], [], ["2025"]],
  ["CATL 동력전지 출하량", ["catl"], [], ["shipment_"], []],
  ["룽바이 2025년 3분기 매출총이익", ["ronbay"], ["gross_profit"], [], ["2025Q3"]],
  ["비야디 2024Q1 매출원가", ["byd"], ["operating_cost"], [], ["2024Q1"]],
];
for (const [question, companies, keys, prefixes, periods] of table) {
  const parsed = m.parseMetricQuestion(question, { now: NOW });
  assert.ok(parsed, `발동해야 한다: ${question}`);
  assert.deepEqual(parsed.companies, companies, `회사: ${question}`);
  assert.deepEqual([...parsed.metrics.keys].sort(), [...keys].sort(), `지표: ${question}`);
  assert.deepEqual(parsed.metrics.prefixes, prefixes, `접두어: ${question}`);
  assert.deepEqual(parsed.periods, periods, `기간: ${question}`);
}

// "해외 매출"이 "매출"까지 같이 잡으면 전사 매출 칸이 섞여 들어온다.
assert.deepEqual(m.matchMetrics("CATL 해외 매출").keys, ["overseas_revenue"], "해외 매출은 전사 매출을 함께 잡지 않는다");

// (2) 발동 조건. 회사 없음 / 지표 없음 / 둘 다 없음 → null.
assert.equal(m.parseMetricQuestion("매출이 가장 큰 회사는?"), null, "회사가 없으면 발동하지 않는다");
assert.equal(m.parseMetricQuestion("CATL의 나트륨 전지 양산 시점은?"), null, "지표가 없으면 발동하지 않는다");
assert.equal(m.parseMetricQuestion("전고체 배터리 동향"), null, "둘 다 없으면 발동하지 않는다");

// 여러 회사가 나오면 전부 잡는다(비교 질문).
assert.deepEqual(m.parseMetricQuestion("CATL과 BYD의 2025년 매출 비교").companies.sort(), ["byd", "catl"]);

// 기간 없는 질문은 빈 배열. 호출자가 최신순으로 상한을 건다.
assert.deepEqual(m.parseMetricQuestion("CATL 매출").periods, []);

// (3) 가짜 청크. 등급 라벨이 본문·출처명·metric_grade에 모두 있어야 한다 — 어느 한 곳만 보는 소비자가 있다.
const reportRow = {
  company_id: "catl", period: "2023", metric: "revenue_total", value: "4009.170449", unit: "CNY_100M",
  line_item_zh: "营业总收入", quantity_text: "40,091,704.49 万元", yoy_pct_stated: 22.01,
  excerpt: "公司实现营业总收入 40,091,704.49 万元，同比增长 22.01%", report_kind: "annual_report",
  source_url: "https://example.test/catl-2023.pdf", occurred_at: "2023-12-31",
};
const marketRow = {
  company_id: "catl", period: "2025", metric: "revenue_total", value: "4237.01834", unit: "CNY_100M",
  currency: "CNY", item_zh: "营业总收入", yoy_pct: 17.04, report_date: "2025-12-31", source: "eastmoney:income_statement",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fromReport = m.chunkFromReportMetric(reportRow);
assert.equal(fromReport.source_type, "metric_row");
assert.equal(fromReport.metric_grade, "excerpt");
// id는 실제 knowledge_chunk 행이 아니므로 UUID 형식이기만 하면 된다(rag_evaluation.chunk_id가
// 이 값을 받는다 — 2026-09-09, "저장 실패: invalid_chunk_id" 재현 후 판정 대상 포함으로 수정).
// 같은 칸을 두 번 만들면 항상 같은 id여야 재평가가 새 행을 쌓지 않고 덮어쓴다.
assert.match(fromReport.id, UUID, "정량 행 id는 UUID 형식이어야 한다");
assert.equal(fromReport.id, m.chunkFromReportMetric(reportRow).id, "같은 칸은 항상 같은 id");
assert.notEqual(fromReport.id, m.chunkFromReportMetric({ ...reportRow, period: "2024" }).id, "다른 칸은 다른 id");
assert.match(fromReport.content_ko, /닝더스다이\(CATL\) 2023년 매출 4,009\.2억 위안, 전년 대비 \+22\.01%/, "값·단위·증감률이 한국어로 읽혀야 한다");
assert.match(fromReport.content_ko, /보고서 발췌/);
assert.equal(fromReport.original_excerpt, reportRow.excerpt, "원문 발췌를 그대로 싣는다");
assert.equal(fromReport.source_url, reportRow.source_url);

const fromMarket = m.chunkFromMarketFinancial(marketRow);
assert.equal(fromMarket.metric_grade, "provider");
assert.match(fromMarket.id, UUID, "제공자 값도 UUID 형식이어야 한다");
assert.notEqual(fromMarket.id, fromReport.id, "같은 칸이어도 report/market 출처가 다르면 id가 다르다");
assert.match(fromMarket.content_ko, /원문 발췌 없음/, "발췌 없는 행은 본문에 등급을 밝힌다");
assert.match(fromMarket.source_name, /원문 발췌 없음/, "출처명에도 밝힌다");
assert.match(fromMarket.content_ko, /4,237억 위안, 전년 대비 \+17\.04%/, "100 이상은 소수 첫째 자리까지, 끝의 .0은 뗀다");
assert.equal(fromMarket.original_excerpt, "", "발췌를 지어내지 않는다");
assert.equal(fromMarket.source_url, null);

// (4) 같은 칸은 report_metric이 이긴다. 다른 칸은 둘 다 남고 최신순이다.
const merged = m.mergeMetricRows([reportRow], [marketRow, { ...marketRow, period: "2023", value: "4009.17045" }]);
assert.equal(merged.length, 2, "같은 칸(2023 매출)은 하나만 남는다");
assert.equal(merged[0].id, fromMarket.id, "최신 기간(2025, market)이 앞");
assert.equal(merged[1].metric_grade, "excerpt", "겹친 칸은 발췌 있는 쪽이 남는다");
assert.equal(m.mergeMetricRows([reportRow, reportRow], [], { limit: 1 }).length, 1, "상한을 지킨다");

// PostgREST 필터. 키만 / 접두어 섞임.
assert.equal(m.metricFilter({ keys: ["revenue_total"], prefixes: [] }), "metric=in.(revenue_total)");
assert.equal(m.metricFilter({ keys: ["net_profit_attr"], prefixes: ["shipment_"] }), "or=(metric.in.(net_profit_attr),metric.like.shipment_*)");

// (5) 조회 함수는 supabaseRest를 주입받는다. 두 테이블을 다 치고, 한쪽이 죽어도 다른 쪽을 낸다.
const calls = [];
const fakeRest = async (path) => {
  calls.push(path);
  if (path.startsWith("report_metric?")) throw new Error("boom");
  if (path.startsWith("market_financial?")) return [marketRow];
  return [];
};
const rows = await m.lookupMetrics(m.parseMetricQuestion("CATL의 2025년 매출은?"), { supabaseRest: fakeRest });
assert.equal(calls.length, 2, "두 테이블을 모두 조회한다");
assert.ok(calls.every((path) => path.includes("company_id=in.(catl)") && path.includes("period=in.(2025)") && path.includes("metric=in.(revenue_total)")), `필터가 셋 다 붙어야 한다: ${calls.join(" | ")}`);
assert.equal(rows.length, 1, "report_metric이 죽어도 market_financial 행은 낸다");
assert.equal(await m.lookupMetrics(null, { supabaseRest: fakeRest }).then((r) => r.length), 0, "발동 안 한 질문은 조회하지 않는다");

// (6) 검색·답변·화면이 등급을 실제로 다루는지. 함수만 있고 안 쓰면 아무것도 바뀌지 않는다.
const search = fs.readFileSync(new URL("../lib/knowledge-search.js", import.meta.url), "utf8");
assert.match(search, /lookupMetrics\(parsed, \{ supabaseRest, limit: METRIC_ROW_LIMIT \}\)/, "검색이 정량 조회를 부른다");
// 회사 후처리(demoteUnrelatedCompanies)를 거친 목록(ordered)에서 자른다. fused를 직접 자르면 후처리가 무효다.
assert.match(search, /const top = \[\.\.\.metricChunks, \.\.\.scopedOrdered\.slice\(0, Math\.max\(0, limit - metricChunks\.length\)\)\]/, "정량 행이 앞, 해당 회사로 좁힌 검색 결과가 뒤, 합쳐서 상한");
assert.match(search, /METRIC_ROW_LIMIT = Math\.floor\(MATCH_COUNT \/ 2\)/, "정량 행은 프롬프트의 절반까지만");
assert.match(search, /\[정량 · 제공자 집계값 · 발췌 없음\]/, "프롬프트 근거 라벨");
assert.match(search, /합계·평균·성장률을 새로 계산하지 않는다/, "파생 계산 금지가 프롬프트에 있다");
assert.match(search, /metric_grade: chunk\.source_type === "metric_row" \? chunk\.metric_grade : null/, "응답 sources에 등급을 실어 보낸다");

const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(app, /source\.metric_grade === 'provider' \? ' <span class="ask-grade provider">거래소 집계값 · 원문 발췌 없음<\/span>'/, "화면이 발췌 없는 행을 배지로 구분한다");
assert.match(app, /by\[0\] === 'metric' \? ' <span class="ask-route metric">정량 조회<\/span>'/, "화면이 정량 조회 경로를 표시한다");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
// 정확한 태그를 고정하지 않는다 — 뒤에 오는 화면 변경이 버전을 또 올린다. 이 기능 이전 태그(0908)만 아니면 된다.
assert.match(html, /app\.js\?v=(?!20260908)\d{8}-/, "캐시 버전을 올려야 배포 뒤 옛 app.js가 남지 않는다");

console.log("ok  check-metric-lookup: 파싱 12케이스 · 발동 조건 · 등급 라벨 · 칸 중복 제거 · 주입 조회 · 배선 확인");
