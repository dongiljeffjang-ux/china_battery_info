import assert from "node:assert/strict";
import fs from "node:fs";

// 기업 궤적 화면의 지표 선택 패널 회귀. 네트워크·LLM을 쓰지 않는다.
//
// 지키려는 성질.
//   1. 재무 지표는 손익계산서를 위에서 아래로 읽는 순서로 놓인다. 매출 다음에 매출원가가 온다.
//   2. '=' 는 원문 계정끼리 정확히 성립하는 자리에만 붙는다. 화면이 없는 항등식을 만들면
//      사용자가 그것을 근거로 계산한다.
//   3. 재무와 그 외(물량·생산능력)가 서로 다른 열에 놓이고, 각 열은 세로로 쌓인다.
//   4. 선택 상태는 클릭 처리가 찾는 data-metric으로 남는다.

const source = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const region = source.slice(source.indexOf("const METRIC_LABELS = {"), source.indexOf("const TRAJ = {"));
assert.ok(region.length > 1000, "지표 선택 구간을 찾지 못했다");

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const exported = new Function("escapeHtml", `${region}
  return { PL_ROWS, CASHFLOW_ROWS, MONEY_METRIC_ORDER, FINANCIAL_METRICS, METRIC_LABELS,
    metricLabel, metricSortKey, volumeMetricParts, metricPickerMarkup };`)(escapeHtml);
const { PL_ROWS, MONEY_METRIC_ORDER, FINANCIAL_METRICS, metricLabel, metricSortKey, metricPickerMarkup } = exported;

// --- 1) 손익계산서 순서 ------------------------------------------------------

const order = PL_ROWS.map((row) => row.metric);
const at = (metric) => order.indexOf(metric);
assert.ok(at("revenue_total") === 0, "맨 위는 매출이어야 한다");
assert.ok(at("revenue_total") < at("operating_cost"), "매출이 매출원가보다 위에 있어야 한다");
assert.ok(at("operating_cost") < at("gross_profit"), "매출원가가 매출총이익보다 위에 있어야 한다");
assert.ok(at("gross_profit") < at("operating_profit"), "매출총이익이 영업이익보다 위에 있어야 한다");
assert.ok(at("operating_profit") < at("total_profit"), "영업이익이 세전이익보다 위에 있어야 한다");
assert.ok(at("total_profit") < at("net_profit"), "세전이익이 순이익보다 위에 있어야 한다");
assert.ok(at("net_profit") < at("net_profit_attr"), "순이익이 지배주주 순이익보다 위에 있어야 한다");
assert.ok(at("overseas_revenue") > at("revenue_total") && at("overseas_revenue") < at("operating_cost"),
  "해외 매출은 매출의 내역이므로 매출 바로 아래여야 한다");
assert.ok(!order.includes("ocf"), "영업활동 현금흐름은 손익계산서가 아니라 현금흐름표다");
assert.ok(MONEY_METRIC_ORDER.includes("ocf"), "현금흐름 항목도 재무 지표 목록에는 있어야 한다");

// 정렬 키가 이 순서를 그대로 따라야 목록의 기본 선택이 매출이 된다.
const sorted = ["net_profit_attr", "operating_cost", "revenue_total", "shipment_power"].sort((a, b) => metricSortKey(a) - metricSortKey(b));
assert.equal(sorted[0], "revenue_total", "정렬하면 매출이 맨 앞이어야 한다");
assert.equal(sorted.at(-1), "shipment_power", "물량은 재무 뒤로 가야 한다");

// --- 2) '=' 는 정확히 성립하는 자리에만 ---------------------------------------

const exact = PL_ROWS.filter((row) => row.rel === "eq").map((row) => row.metric);
assert.deepEqual(exact, ["gross_profit"],
  "매출 − 매출원가 = 매출총이익만 원문 계정끼리 정확하다. 다른 자리에 '='를 붙이면 없는 항등식을 만든다");
for (const metric of ["operating_profit", "total_profit", "net_profit"]) {
  const row = PL_ROWS.find((item) => item.metric === metric);
  assert.equal(row.rel, "next", `${metric}은 중간 계정이 생략된 구간이라 '↓'여야 한다`);
}
for (const metric of ["overseas_revenue", "net_profit_attr", "net_profit_excl"]) {
  assert.equal(PL_ROWS.find((item) => item.metric === metric).rel, "of",
    `${metric}은 더하거나 빼는 관계가 아니라 윗 항목의 내역이다`);
}

// --- 3) 두 열 구조 ----------------------------------------------------------

const available = [
  "revenue_total", "operating_cost", "operating_profit", "total_profit", "net_profit_attr", "net_profit_excl", "ocf",
  "shipment_power", "shipment_ess", "installed_power", "capacity_cathode_lfp", "capacity_plan_cell",
];
const picker = metricPickerMarkup(available, "revenue_total");
const html = picker.financial + picker.other;

// 두 열은 따로 돌려줘야 호출자가 그래프를 사이에 넣을 수 있다. 하나로 묶어 주면 그래프가
// 메뉴 아래로 밀려 위에서 봤던 배치로 되돌아간다.
assert.ok(typeof picker.financial === "string" && typeof picker.other === "string",
  "재무 열과 그 외 열을 따로 돌려줘야 한다");
assert.ok(!html.includes("traj-picker"), "두 열을 한 상자로 묶으면 안 된다");
const left = picker.financial;
const right = picker.other;
assert.ok(left.includes("traj-col-left") && right.includes("traj-col-right"), "좌우 열에 자리 표시가 있어야 한다");
assert.ok(left.includes("재무 · 손익계산서 순"), "왼쪽 열은 재무여야 한다");
assert.ok(right.includes("물량 · 생산능력"), "오른쪽 열은 그 외여야 한다");

// 렌더가 실제로 그래프를 두 열 사이에 넣는지 소스로 확인한다.
const stageStart = source.indexOf('<div class="traj-stage">');
assert.ok(stageStart > 0, "그래프를 감싸는 traj-stage를 찾지 못했다");
const stage = source.slice(stageStart, source.indexOf('<p class="traj-note">가로축은'));
assert.ok(stage.indexOf("${picker.financial}") < stage.indexOf("traj-svg"), "재무 열이 그래프보다 앞에 와야 한다");
assert.ok(stage.indexOf("traj-svg") < stage.indexOf("${picker.other}"), "그 외 열이 그래프보다 뒤에 와야 한다");

// 재무 지표는 전부 왼쪽에, 물량은 전부 오른쪽에.
for (const metric of available.filter((m) => FINANCIAL_METRICS.has(m))) {
  assert.ok(left.includes(`data-metric="${metric}"`), `${metric}은 왼쪽 재무 열에 있어야 한다`);
  assert.ok(!right.includes(`data-metric="${metric}"`), `${metric}이 오른쪽에도 있으면 안 된다`);
}
for (const metric of available.filter((m) => !FINANCIAL_METRICS.has(m))) {
  assert.ok(right.includes(`data-metric="${metric}"`), `${metric}은 오른쪽 열에 있어야 한다`);
  assert.ok(!left.includes(`data-metric="${metric}"`), `${metric}이 왼쪽에도 있으면 안 된다`);
}

// 왼쪽 열 안에서 매출이 매출원가보다 먼저 나와야 세로로 읽힌다.
assert.ok(left.indexOf('data-metric="revenue_total"') < left.indexOf('data-metric="operating_cost"'),
  "화면에서도 매출이 매출원가보다 위에 있어야 한다");
assert.ok(left.indexOf('data-metric="operating_profit"') < left.indexOf('data-metric="net_profit_attr"'),
  "영업이익이 지배주주 순이익보다 위에 있어야 한다");

// 물량은 종류별로 묶인다.
assert.ok(right.includes("출하량") && right.includes("장착량") && right.includes("생산능력"),
  "물량은 출하량·장착량·생산능력으로 묶어야 한다");
assert.ok(right.indexOf("출하량") < right.indexOf("장착량"), "묶음 순서는 출하량 → 장착량 → 생산능력이다");
// 계획값은 실적 뒤로.
const capacityBlock = right.slice(right.indexOf("생산능력"));
assert.ok(capacityBlock.indexOf('data-metric="capacity_cathode_lfp"') < capacityBlock.indexOf('data-metric="capacity_plan_cell"'),
  "계획값은 그 기간의 실적이 아니므로 묶음 뒤로 가야 한다");

// 묶음 안의 칩은 종류를 되풀이하지 않는다. 묶음 제목이 이미 그것을 말한다.
assert.ok(right.includes(">동력전지</button>"), "출하량 묶음의 칩은 '동력전지'로 적어야 한다");
assert.ok(!right.includes(">출하량 · 동력전지</button>"), "칩에 묶음 이름을 되풀이하면 폭만 먹는다");
// 다만 화면 낭독기에는 전체 이름이 남아야 묶음 맥락이 사라지지 않는다.
assert.ok(right.includes('aria-label="출하량 · 동력전지"'), "칩의 aria-label에는 전체 이름이 있어야 한다");
// 누적·계획은 실적이 아니므로 칩에 표시를 남긴다.
assert.ok(/>\(계획\) [^<]*<\/button>/.test(right), "계획값은 칩에 (계획) 표시가 있어야 한다");
// 재무 칩은 줄임 없이 전체 이름을 쓴다(사다리에는 묶음 제목이 대신해 줄 것이 없다).
assert.ok(left.includes(">지배주주 순이익</button>"), "재무 칩은 전체 이름을 그대로 쓴다");

// --- 4) 선택 상태와 클릭 대상 -------------------------------------------------

assert.ok(html.includes('data-metric="revenue_total" aria-current="true"'), "현재 지표에 aria-current가 붙어야 한다");
assert.equal((html.match(/class="traj-chip active"/g) || []).length, 1, "활성 지표는 하나여야 한다");
assert.equal((html.match(/traj-chip/g) || []).length, available.length, "선택지 수가 available와 같아야 한다");
// 클릭 처리기는 .traj-chip[data-metric]을 찾는다. 클래스 이름을 바꾸면 선택이 죽는다.
const render = source.slice(source.indexOf("target.querySelectorAll('.traj-chip')"));
assert.ok(render.startsWith("target.querySelectorAll('.traj-chip').forEach"), "클릭 처리기가 .traj-chip을 계속 찾아야 한다");

// 없는 지표는 그리지 않는다(회사마다 가진 계정이 다르다).
const sparsePicker = metricPickerMarkup(["revenue_total", "net_profit_attr"], "revenue_total");
const sparse = sparsePicker.financial + sparsePicker.other;
assert.ok(!sparse.includes('data-metric="operating_cost"'), "없는 계정을 빈 줄로 만들면 안 된다");
assert.ok(sparse.includes("이 회사는 물량 지표가 없습니다"), "물량이 없으면 그렇다고 적어야 한다");
assert.ok(!sparse.includes('<span class="traj-rel exact">=</span> 는'), "'=' 자리가 없으면 그 범례도 띄우지 않는다");

// --- 5) 좌우 칸과 그래프의 위아래를 맞춘다 -------------------------------------

// CSS는 노드에서 그려 볼 수 없으므로 의도만 고정한다. stretch가 start로 돌아가면 칸마다
// 높이가 달라져 화면이 어긋난다(2026-09-08 사용자 지적).
const css = fs.readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
const stageCss = css.slice(css.indexOf(".traj-stage{"), css.indexOf(".traj-plot{"));
assert.ok(/align-items:stretch/.test(stageCss), "세 칸의 위아래를 맞추려면 stretch여야 한다");
// 그래프는 칸의 남는 높이를 채운다. 옛 방식(가운데 정렬 + 고정 종횡비)은 항목이 많은 회사에서
// 위아래가 크게 남았다(2026-09-08 사용자 지적).
assert.ok(/\.traj-svg\{[^}]*height:100%/.test(css), "그래프는 칸 높이를 그대로 채워야 한다");
// 그래프는 흐름에서 빠져 있어야 한다. 흐름 안에 두면 한 번 커진 그래프가 스스로 행 높이를
// 키우고 그 높이에 다시 맞춰 영영 줄어들지 않는다(2026-09-08 실측: 892px까지 커졌다).
assert.ok(/\.traj-plot\{[^}]*position:relative/.test(css), "그래프 칸이 기준 상자가 되어야 한다");
assert.ok(/\.traj-svg\{[^}]*position:absolute/.test(css), "그래프가 행 높이에 끼어들면 안 된다");
// 좁은 화면에서는 그래프가 자기 행으로 빠져 채울 높이가 정해지지 않는다. 그때는 흐름으로 돌아간다.
const narrow = css.slice(css.indexOf("@media (max-width:900px)"));
assert.ok(/\.traj-plot\{position:static\}/.test(narrow), "좁은 화면에서는 그래프를 흐름 안으로 되돌려야 한다");
assert.ok(/\.traj-svg\{position:static;height:auto\}/.test(narrow), "좁은 화면에서는 폭 기준 비율로 물러나야 한다");
// 늘여서 채우면 점과 플래그가 타원이 된다. 좌표계를 맞추는 방식이어야 한다.
assert.ok(!/preserveAspectRatio="none"/.test(source), "SVG를 늘여 채우면 점이 타원으로 찌그러진다");
assert.ok(/function trajGeometry\(/.test(source), "실제 칸 높이에 맞춰 좌표계를 다시 잡는 함수가 있어야 한다");
const refit = source.slice(source.indexOf("function refitTrajectory("), source.indexOf("function observeTrajectoryPlot("));
assert.ok(refit.includes("renderTrajectory(timeline)"), "어긋나면 다시 그려야 한다");
// 지금 그려진 viewBox와 견준다. 그래야 다시 그리기가 스스로 멈춘다.
assert.ok(refit.includes("svgBox.getAttribute('viewBox')"), "현재 좌표계와 견주어야 멈춘다");
assert.ok(/Math\.abs\(wanted - current\) <= 2/.test(refit), "어긋남이 작으면 다시 그리지 않아야 한다");
// 첫 맞춤은 동기로 한다. requestAnimationFrame은 탭이 가려지면 오지 않아 첫 그림이 어긋난 채 남는다.
assert.ok(!/requestAnimationFrame\(\(\) => refitTrajectory/.test(source),
  "첫 맞춤을 rAF에 맡기면 탭이 가려졌을 때 놓친다");
assert.ok(source.includes("observeTrajectoryPlot(target, timeline);"), "칸 크기 변화를 따라갈 관찰자를 붙여야 한다");
assert.ok(/new ResizeObserver\(\(\) => refitTrajectory\(timeline\)\)/.test(source), "ResizeObserver로 따라잡아야 한다");
// 늘어난 높이는 꺾은선 영역이 가져간다. 점 크기·글자 크기는 회사마다 달라지면 안 된다.
assert.ok(/const TRAJ_BELOW_PLOT = TRAJ\.height - TRAJ\.plotHeight;/.test(source),
  "축 아래(플래그·연도) 예산은 높이가 변해도 그대로여야 한다");
assert.ok(/\.traj-groups\{[^}]*flex:1/.test(css), "오른쪽 묶음 상자가 남는 세로 공간을 받아야 한다");
// 버튼은 크기를 고정하고 남는 세로 공간은 버튼 사이에 나눈다. 버튼이 늘어나게 두면
// 한 묶음에 항목이 하나뿐일 때 138px짜리 덩어리가 된다(2026-09-08 실측).
assert.ok(/\.traj-list li\{[^}]*flex:0 0 auto/.test(css), "목록 항목이 늘어나면 버튼이 덩어리가 된다");
assert.ok(/\.traj-list\{[^}]*justify-content:space-evenly/.test(css), "남는 공간은 버튼 사이에 고르게 나눈다");
assert.ok(/\.traj-list \.traj-chip\{[^}]*min-height/.test(css), "버튼에 최소 높이가 있어야 눌러야 할 것으로 읽힌다");

// --- 6) 좌표계 계산 -----------------------------------------------------------

const geoRegion = source.slice(source.indexOf("const TRAJ = {"), source.indexOf("let trajectoryMetric"));
const { trajGeometry, TRAJ } = new Function(`${geoRegion} return { trajGeometry, TRAJ };`)();

// 기준 높이를 넣으면 옛 좌표계 그대로여야 한다. 여기가 어긋나면 모든 회사의 그림이 함께 바뀐다.
const base = trajGeometry(TRAJ.height);
assert.equal(base.height, TRAJ.height);
assert.equal(base.plotHeight, TRAJ.plotHeight);
assert.equal(base.axisY, TRAJ.axisY);

// 늘어난 높이는 전부 꺾은선 영역이 가져간다.
const tall = trajGeometry(652);
assert.equal(tall.plotHeight, 652 - (TRAJ.height - TRAJ.plotHeight), "남는 높이는 플롯이 가져간다");
assert.equal(tall.height, 652);
// 점·플래그·연도 라벨이 쓰는 값은 높이가 변해도 그대로다. 회사마다 점 크기가 달라지면 안 된다.
for (const key of ["plotTop", "laneGap", "padX", "width"]) {
  assert.equal(tall[key], TRAJ[key], `${key}는 높이가 변해도 그대로여야 한다`);
}
// 축 아래 예산이 그대로이므로 플래그가 놓일 자리도 같은 거리에 남는다.
assert.equal(tall.height - tall.axisY, TRAJ.height - TRAJ.axisY, "축부터 아래 끝까지의 여백은 고정이다");

// 칸이 아주 낮아도 플롯이 음수가 되지 않는다.
const squat = trajGeometry(40);
assert.ok(squat.plotHeight >= 60, "플롯 높이에 하한이 있어야 한다");
assert.ok(squat.axisY < squat.height, "축이 그림 밖으로 나가면 안 된다");

console.log("ok  metric-picker");
