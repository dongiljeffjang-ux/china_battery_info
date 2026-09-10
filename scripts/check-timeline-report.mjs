import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timeline, api, app, html] = await Promise.all([
  readFile(new URL("../lib/timeline-report.js", import.meta.url), "utf8"),
  readFile(new URL("../api/company.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

// 지시문은 사용자가 직접 쓴 것이다. 여기서는 문장을 통째로 지키는 대신, 이 저장소의
// 불변조건과 직결되는 조항만 남아 있는지 본다.
assert.match(timeline, /투자 추천이나 기업 홍보 문서를 작성하지 않는다/, "투자 추천 금지 조항");
assert.match(timeline, /출처·원문·링크를 만들어내지 않는다/, "출처 날조 금지 조항");
assert.match(timeline, /활동이 없거나 중단되었다고 해석하지 않는다/, "결측을 중단으로 읽지 않는다");
assert.match(timeline, /계획 생산능력과 가동·생산 실적/, "계획과 실적을 가르는 조항");
assert.match(timeline, /계약·전략협력·MOU를 실제 출하·매출로 취급하지 않는다/, "계약을 실적으로 읽지 않는다");
assert.match(timeline, /발표일, 실제 사건 발생일, 통계 대상 기간을 구분한다/, "시점 구분 조항");
assert.match(timeline, /핵심 변화는 최대 3개만 선정하라/, "핵심 변화 상한");
assert.match(timeline, /확인된 것 \/ 아직 모르는 것 \/ 다음 확인 지표/, "외부 독자의 판단 구조");
assert.match(timeline, /영업이익률 = 영업이익 ÷ 매출 × 100/, "비교 가능한 실적의 수익성 계산");
assert.match(timeline, /기업 자체의 개선과 시장·경쟁사 대비 개선을 구분한다/, "자체 개선과 경쟁우위 구분");
assert.match(timeline, /같은 수치·한계·결론을 두 번 이상 설명하지 않았는가/, "반복 제거 자체검수");
// 화면이 Markdown을 렌더링한다. 모델이 HTML을 내면 그대로 문자열이 보인다.
assert.match(timeline, /반환 형식은 Markdown이다/, "반환 형식을 Markdown으로 못박아야 한다");
assert.match(timeline, /report_markdown_ko/, "스키마는 Markdown 한 필드다");
assert.doesNotMatch(timeline, /webSearch\s*:\s*true/);
// 입력에 없는 자료를 있다고 가정하지 않게 명시한다.
assert.match(timeline, /기존 보고서 또는 HTML: 없음/, "없는 입력은 없다고 적어야 한다");
assert.match(timeline, /이전 회차 보고서: 없음/);
assert.match(api, /mode\s*\|\|\s*""\)\s*===\s*"timeline_report"/);
assert.match(api, /cleanTimelineEvents/);
assert.match(api, /sourceUrl/);
assert.doesNotMatch(api, /result\.report\.turning_points/, "Markdown 리포트에는 이전 turning_points 구조를 읽으면 안 된다");
assert.match(timeline, /시장-실적\/생산기반/);
assert.match(timeline, /function layerTable/);
assert.match(html, /id="company-timeline-report"/);
assert.match(html, /id="company-timeline-report-panel"/);
assert.match(app, /mode:\s*'timeline_report'/);
assert.match(app, /function chooseReportSupporting/);
assert.match(app, /보조 정보를 포함할까요/);
assert.match(app, /await chooseReportSupporting\(\);/);
assert.match(app, /period:\s*periodOf\(event\.date\)/);
assert.match(app, /HTML로 저장/);
assert.match(app, /new Blob\(\[.*text\/html;charset=utf-8/s);
assert.match(app, /function renderTimelineMarkdown/);
assert.doesNotMatch(app, /<pre class="timeline-report-markdown">/, "리포트 Markdown 원문을 pre에 그대로 표시하면 안 된다");

// Markdown 렌더러가 실제로 무엇을 살리는지 돌려서 확인한다. 문자열 검사만으로는
// "<br>이 글자로 보인다" 같은 문제를 못 잡는다.
const renderSource = app.slice(app.indexOf("// 리포트 출력은 제한된 Markdown만"), app.indexOf("function timelineReportParts"));
assert.ok(renderSource, "Markdown 렌더러를 찾지 못했다");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const renderTimelineMarkdown = new Function("escapeHtml", renderSource + "; return renderTimelineMarkdown;")(escapeHtml);
const rendered = renderTimelineMarkdown([
  "# 제목",
  "본문 **굵게** 와 *기울임* 과 `코드`.",
  "1. 첫째",
  "2. 둘째",
  "- 불릿",
  "| 지표 | 값 |",
  "| --- | --- |",
  "| 매출 | **4,237억** |",
  "> 인용",
  "---",
  "[링크](https://example.com/a.pdf) 와 줄바꿈 <br> 태그.",
  "<script>alert(1)</script>",
].join("\n"));

// 모델이 표에 <br>을 넣어 보내면 예전에는 글자 "<br>"이 그대로 보였다.
assert.ok(rendered.includes("<br>"), "<br>은 줄바꿈으로 살려야 한다");
assert.doesNotMatch(rendered, /&lt;br&gt;/, "<br>이 글자로 보이면 안 된다");
assert.ok(rendered.includes("<strong>굵게</strong>"), "굵게 표기를 살려야 한다");
assert.ok(rendered.includes("<em>기울임</em>"), "기울임 표기를 살려야 한다");
assert.ok(rendered.includes("<code>코드</code>"), "코드 표기를 살려야 한다");
assert.ok(rendered.includes("<ol"), "번호 목록을 살려야 한다");
assert.ok(rendered.includes("<ul"), "불릿 목록을 살려야 한다");
assert.ok(rendered.includes("<td><strong>4,237억</strong></td>"), "표 안의 표기도 살려야 한다");
assert.ok(rendered.includes("<blockquote>"), "인용을 살려야 한다");
assert.ok(rendered.includes("<hr>"), "가로줄을 살려야 한다");
assert.ok(rendered.includes('rel="noreferrer"'), "링크는 새 탭으로 열어야 한다");
assert.ok(rendered.includes("<h2>제목</h2>"), "제목 단계를 화면 위계에 맞춰 낮춰야 한다");
// 모델이 태그를 뱉어도 실행되면 안 된다. 아는 표기만 되살린다.
assert.doesNotMatch(rendered, /<script>/, "모델이 보낸 스크립트가 살아나면 안 된다");
assert.ok(rendered.includes("&lt;script&gt;"), "모르는 태그는 글자로 남아야 한다");

// 모델이 <br>을 따라 뱉지 않도록 입력 표에서도 그 태그를 쓰지 않는다.
assert.doesNotMatch(timeline, /join\("<br>"\)/, "입력 표의 셀 구분에 <br>을 쓰면 모델이 그대로 따라한다");
assert.match(app, /서버 히스토리나 DB에는 저장되지 않습니다/);

// 모델이 실제로 받는 입력을 조립해 본다. 리포트가 "이 회사가 어디로 가는지"를 못 읽던 원인은
// 정량 시계열을 아예 안 주고 사건 조각만 최신순으로 준 데 있었다. 그 구조를 여기서 고정한다.
const { buildTimelineInput, metricTable, selectTimelineEvidence } = await import("../lib/timeline-report.js");
const sampleMetrics = [
  { period: "2023", metric: "revenue_total", value: 4009.17, unit: "CNY_100M", yoy_pct: 22.01 },
  { period: "2024", metric: "revenue_total", value: 3620.13, unit: "CNY_100M", yoy_pct: -9.7 },
  { period: "2025", metric: "revenue_total", value: 4237.02, unit: "CNY_100M", yoy_pct: 17.04 },
  { period: "2025H1", metric: "revenue_total", value: 1788.86, unit: "CNY_100M", yoy_pct: 7.27 },
  { period: "2026Q1", metric: "revenue_total", value: 1291.31, unit: "CNY_100M", yoy_pct: 52.45 },
  { period: "2026H1", metric: "revenue_total", value: 2769.17, unit: "CNY_100M", yoy_pct: 54.8 },
  { period: "2024", metric: "operating_profit", value: 640.52, unit: "CNY_100M", yoy_pct: 19.24 },
  { period: "2025", metric: "shipment_power", value: 541, unit: "GWh", yoy_pct_stated: 41.85 },
  { period: "2025", metric: "capacity_plan_cell", value: 321, unit: "GWh" },
  { period: "2025", metric: "shipment_anode", value: 363500, unit: "t", yoy_pct_stated: 55.66 },
];
const sampleEvents = [
  { id: "a45f53f5-9ca7-4859-96ce-8199b495cb7b", date: "2025-12-31", period: "2025 하반기", layer: "supply-performance", title: "판매 661GWh", fact: "2025년 판매량 661GWh.", sourceName: "연차보고서", sourceUrl: "https://static.cninfo.com.cn/x.PDF" },
  { id: "b", date: "2023-12-31", period: "2023 하반기", layer: "technology-development", title: "응집태 전지 발표", fact: "발표.", sourceName: "연차보고서", sourceUrl: "" },
  { id: "c", date: "2026-06-30", period: "2026 Q2", layer: "regional-overseas", title: "해외 매출 871억", fact: "매출의 31.46%.", sourceName: "반기보고서", sourceUrl: "https://static.cninfo.com.cn/y.PDF" },
];
const input = buildTimelineInput({ companyName: "CATL", events: sampleEvents, metrics: sampleMetrics });

// 이벤트 UUID가 입력에 들어가면 지시문의 "ID 보존" 조항 때문에 본문에 [a45f53f5-…]가 박힌다.
assert.ok(!input.includes("a45f53f5"), "이벤트 UUID를 모델 입력에 넣으면 안 된다");
assert.match(input, /이벤트 식별자는 제공하지 않았으므로/, "식별자를 만들어 넣지 말라고 적어야 한다");
assert.ok(!input.includes("<br>"), "입력에 <br>이 있으면 모델이 따라 뱉는다");
// 방향은 숫자에서 먼저 읽는다. 정량 표가 사건 표보다 앞에 온다.
assert.ok(input.indexOf("정량 시계열") < input.indexOf("화면 이벤트 3건"), "정량 표가 사건 표보다 앞이어야 한다");
assert.match(input, /읽는 순서: 먼저 정량 시계열에서/);
// 사건은 과거 → 최근. 최신순이면 흐름을 거꾸로 읽는다.
assert.ok(input.indexOf("2023 하반기") < input.indexOf("2025 하반기") && input.indexOf("2025 하반기") < input.indexOf("2026 Q2"), "사건 표는 과거 → 최근 순이어야 한다");
// 열: 연간 + 아직 연간이 안 나온 당해의 최신 누적 하나. 지난 해 반기는 연간이 있으니 뺀다.
assert.ok(input.includes("| 지표 | 2023 연간 | 2024 연간 | 2025 연간 | 2026 H1 누적 |"), "열은 연간 + 당해 최신 누적이어야 한다");
assert.ok(!input.includes("2025 H1 누적"), "연간이 있는 해의 반기값은 열에 넣지 않는다");
// "2026H1" < "2026Q1" 문자열 정렬 때문에 3월이 6월보다 최신으로 뽑히던 버그.
assert.ok(!input.includes("2026 Q1 누적"), "당해 최신 누적은 결산월이 가장 늦은 것이어야 한다(Q1이 H1을 이기면 안 된다)");
assert.ok(input.includes("| 매출(억 위안) | 4,009 (+22.0%) | 3,620 (-9.7%) | 4,237 (+17.0%) | 2,769 (+54.8%) |"), "매출 행에 원자료 전년비를 붙여야 한다");
assert.ok(input.includes("| 영업이익(억 위안) | 자료 없음 | 641 (+19.2%) | 자료 없음 | 자료 없음 |"), "없는 칸은 '자료 없음'이지 0이 아니다");
assert.ok(input.includes("출하량 · 동력전지(GWh)"), "물량 라벨에 품목과 단위가 붙어야 한다");
assert.ok(input.includes("생산능력(계획) · 리튬이온전지(GWh)"), "계획 생산능력은 실제와 다른 행이어야 한다");
assert.ok(input.includes("| 출하량 · 음극재(만 톤) | 자료 없음 | 자료 없음 | 36.35 (+55.7%) | 자료 없음 |"), "톤은 만 톤으로 줄여 적는다");
assert.equal(metricTable([]), "", "지표가 없으면 표를 만들지 않는다");
assert.match(buildTimelineInput({ companyName: "x", events: sampleEvents, metrics: [] }), /정량 시계열: 없음/, "지표가 없으면 없다고 적는다");
// 보조 데이터를 켜면 수백 건이 화면에 보일 수 있다. 모든 원문을 한 호출에 넘기면 모델 입력이
// 커져 시간 초과하므로, 기간·레이어의 양 끝을 대표 근거로 남기고 전체는 상한 안에 압축한다.
const denseEvents = Array.from({ length: 90 }, (_, index) => ({
  id: `dense-${index}`,
  date: `202${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`,
  period: `202${Math.floor(index / 12)}년`,
  layer: index % 2 ? "supply-performance" : "technology-development",
  title: `[사건-${index}]`,
  fact: `반복된 보조 사실 ${index}`,
  sourceName: "출처",
  sourceUrl: "",
}));
const selectedEvidence = selectTimelineEvidence(denseEvents);
assert.ok(selectedEvidence.length <= 48, "대표 근거 선택기는 48건을 넘기면 안 된다");
assert.equal(selectedEvidence[0].id, "dense-0", "가장 이른 근거는 보존해야 한다");
assert.equal(selectedEvidence.at(-1).id, "dense-89", "가장 최근 근거는 보존해야 한다");
const sourceYears = new Set(denseEvents.map(event => event.date.slice(0, 4)));
const selectedYears = new Set(selectedEvidence.map(event => event.date.slice(0, 4)));
assert.deepEqual([...selectedYears].sort(), [...sourceYears].sort(), "입력 압축 뒤에도 모든 연도의 흐름을 보존해야 한다");
const compactInput = buildTimelineInput({ companyName: "CATL", events: denseEvents });
const compactCount = compactInput.match(/화면 이벤트 90건 중 기간·레이어별 대표 근거 (\d+)건/);
assert.ok(compactCount, "긴 시계열의 대표 근거 수를 표시해야 한다");
assert.ok(Number(compactCount[1]) > 0 && Number(compactCount[1]) <= 24, "대표 근거는 최대 24건 이내여야 한다");
assert.match(timeline, /timeoutMs: 110000/, "압축된 시계열 리포트에는 110초 응답 시간을 준다");
const omittedEvidence = denseEvents.find(event => !selectedEvidence.some(selected => selected.id === event.id));
assert.ok(omittedEvidence && !compactInput.includes(omittedEvidence.title), "선택되지 않은 반복 근거를 모델 입력에 넣으면 안 된다");
// 화면 툴팁의 발생 법인이 리포트 입력에도 들어가야 한다(보조 데이터는 칸에 제목만 보인다).
const entityInput = buildTimelineInput({ companyName: "CATL", events: [{ id: "e1", date: "2026-08-18", period: "2026년", layer: "supply-performance", title: "상용차 협력", fact: "CATL 뉴스룸에 따르면 협력 체결", entity: "CATL 상용차 법인", sourceName: "CATL Newsroom", sourceUrl: "" }] });
assert.match(entityInput, /CATL 뉴스룸에 따르면 협력 체결 \(2026-08-18 · 발생 법인: CATL 상용차 법인 · 출처: CATL Newsroom/, "사실 전문·발생 법인·출처가 리포트 입력에 있어야 한다");
const datedInput = buildTimelineInput({ companyName: "BYD", events: [{ id: "e2", date: "2026-03-05", period: "2026년", layer: "technology-development", title: "2세대 블레이드", fact: "9분 충전", sourceName: "大众日报", sourceDate: "2026-09-04", sourceUrl: "" }] });
assert.match(datedInput, /\(사건 2026-03-05 · 발행 2026-09-04 · 출처: 大众日报/, "기사 발행일이 있으면 사건 시점과 나란히 적는다");
// 2026-09-10 후난위넝 비교 리포트: 레이어 없는 62건(기술 4건)에서 4건만 골라 기술 축이 비었다.
// 남는 칸을 채우고 기술 몫을 보장해야 한다.
const flatEvents = Array.from({ length: 62 }, (_, index) => ({
  id: `flat-${index}`,
  date: `202${3 + Math.floor(index / 16)}-${String((index % 12) + 1).padStart(2, "0")}-15`,
  track: index % 15 === 7 ? "tech" : "market",
  title: index % 15 === 7 ? `[기술-${index}] 특허 보유` : `[시장-${index}] 고객 출하`,
  fact: "사실",
}));
const flatSelected = selectTimelineEvidence(flatEvents, { limit: 18, perBucket: 1 });
assert.equal(flatSelected.length, 18, "대표 근거 뒤 남는 칸을 상한까지 채워야 한다");
assert.equal(flatSelected.filter(event => event.track === "tech").length, flatEvents.filter(event => event.track === "tech").length, "기술 사건이 상한의 1/4보다 적으면 모두 남아야 한다");
assert.deepEqual([...new Set(flatSelected.map(event => event.date.slice(0, 4)))].sort(), [...new Set(flatEvents.map(event => event.date.slice(0, 4)))].sort(), "기술 몫을 채워도 연도 대표는 유지해야 한다");
assert.match(api, /function cleanEvents[\s\S]{0,300}\.slice\(0, 200\)[\s\S]{0,700}layer:[\s\S]{0,100}period:/, "비교 리포트 입력은 레이어·기간을 유지하고 먼저 60건으로 자르지 않는다");
// 기업 API가 실제로 두 표를 읽어 넘기는지.
assert.match(api, /loadReportMetrics\(companyId\)/, "리포트 생성 전에 정량 시계열을 읽어야 한다");
assert.match(api, /market_financial\?select=period,metric,value,unit,yoy_pct/, "거래소 손익 항목을 읽어야 한다");
assert.match(api, /report_metric\?select=period,metric,value,unit,yoy_pct_stated/, "보고서 물량을 읽어야 한다");
assert.match(api, /buildTimelineReport\(\{ companyName: company\.name_ko, companyTags: company\.type_tags, events, metrics, alternatives, policies \}\)/, "정량 행과 기업 유형을 리포트에 넘겨야 한다");

console.log("timeline report checks passed");
