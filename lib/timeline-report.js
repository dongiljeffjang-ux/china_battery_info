import { createJsonResponse } from "./llm-provider.js";
import { POLICY_ANALYSIS_RULE, annotatePolicyCodes, historicalPolicies, policyCodeGlossary } from './policy-context.js';
import { linkedPolicyTable } from './policy-links.js';
import { countHedges, reduceHedges } from './report-phrasing.js';

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};

export const TIMELINE_REPORT_MODES = ["direction", "pattern", "inflection_point"];

// 2026-09-11 전면 개정(사용자 지정). 보고서는 "사실을 근거로 한 해석"을 짧게 읽고 takeaway를 가져가는
// 문서다. 근거가 없어 판단할 수 없는 논점은 쓰지 않는다 — 유보·면책·"판단 불가" 문장을 없앤 이유다.
// 세 용도는 같은 시계열을 서로 다른 단위로 읽는다. 전략 방향은 "두 시점의 대비", 패턴은 "두 개 이상
// 사건의 연결", 분기점은 "진행 중 사건의 두 갈래"다. 용도 절이 출력 골격을 정하고, 공통 지시문은
// 근거·수치·표현 규칙만 가진다.
const MODE_OVERRIDE = "출력 골격은 이 절이 정한다. 골격의 제목을 그대로 쓰고, 골격에 없는 절을 만들지 마라. 근거가 없는 항목은 '자료 없음'이라고 적지 말고 그 항목을 빼라. 공통 지시문의 근거·수치·표현 규칙은 그대로 지킨다.";

// 2026-09-11 사용자 평가("3개 리포트 차별성 평가") 반영. 세 보고서는 같은 사실을 서로 다른 연산으로 읽는다.
//   전략 방향   Compare / Shift / Reallocation — 무엇이 달라졌고 자원·우선순위는 어디로 옮겨 갔는가
//   패턴        Cluster / Generalize / Mechanism — 이 회사는 여러 상황에서 반복적으로 어떻게 행동하는가
//   분기점      Branch / Trigger / Consequence — 어떤 조건이 다음 경로를 바꾸며 무엇을 관찰해야 하는가
// 같은 사실(예: 나트륨 소재 첫 출하)이 전략 방향에서는 "이동의 증거", 패턴에서는 "반복 메커니즘의 사례",
// 분기점에서는 "경로를 가르는 선행 신호"로 쓰여야 세 보고서가 서로 대체되지 않는다.
const REPORT_MODE_GUIDE = {
  direction: [
    "[선택한 보고서 용도: 전략 방향 — Compare / Shift / Reallocation]",
    MODE_OVERRIDE,
    "질문: 무엇이 달라졌으며, 자원과 우선순위는 어디로 이동했는가?",
    "분석 단위는 '과거 상태 대 현재 상태'다. [기준 시점 대비표]와 정량 시계열에서 비교 가능한 가장 오래된 시점과 최근 시점을 고정하고, 제품/화학계·지역·고객·투자·생산능력·기술의 상대적 무게가 어떻게 변했는지 쓴다.",
    "'새 사업이 추가됐다'와 '전략의 중심이 옮겨 갔다'를 구분한다. 매출 비중·출하량·생산능력·투자 규모처럼 상대적 무게의 변화를 보여 주는 근거가 있을 때만 '무게중심 이동'·'전환'이라고 쓰고, 없으면 '전략적 확장'·'포트폴리오 진화'라고 쓴다. 이 보고서에서 사실은 이동(또는 확장)의 증거로만 쓴다.",
    "쓰지 않는 것: 여러 사업에 걸친 반복 행동의 일반화(패턴 보고서의 일), 앞으로 갈릴 경로와 관측 신호(분기점 보고서의 일).",
    "출력 골격:",
    "# 전략 방향: (무게중심이 어디서 어디로 옮겨 갔는지, 또는 어디로 확장됐는지를 담은 결론형 제목)",
    "## 핵심 요약",
    "- (3~4줄. 첫 줄은 '○○에서 ○○로' 이동인지 '○○에 ○○를 더한' 확장인지 판단, 이어서 그것을 보여 주는 대비·결정·한국 셀·소재사 함의를 한 줄씩.)",
    "## 과거 대 현재",
    "| 축 | 과거 (시점) | 현재 (시점) | 달라진 것 | 무게 변화의 근거 |  ← 실제로 무게가 변한 축만 2~4행. 칸마다 수치나 사건 하나. 근거 칸에는 비중·출하·생산능력·투자 수치, 없으면 '근거 없음(확장으로 봄)'.",
    "## 방향을 만든 결정",
    "최대 3개. '### 결론형 제목' 아래 두세 문장: 사실(날짜·수치) → 그것이 자원·우선순위를 어떻게 옮겼는지.",
    "## Takeaway",
    "- (한국 셀·양극재·음극재 사업에 주는 의미 2~3줄. 유리·압박·중립 방향을 분명히.)",
    "## 근거",
  ].join("\n"),
  pattern: [
    "[선택한 보고서 용도: 패턴 인사이트 — Cluster / Generalize / Mechanism]",
    MODE_OVERRIDE,
    "질문: 이 회사는 여러 상황에서 반복적으로 어떻게 행동하는가?",
    "분석 단위는 '반복 구조'다. 패턴은 서로 독립적인 사업·제품·지역·고객군 두 개 이상에서 같은 모양으로 되풀이되는 행동 방식이나 상업화 메커니즘이다(예: 여러 신소재에서 '기술 개발 → 생산능력 확보 → 초기 출하 → 고객 적용 확대'가 같은 순서·비슷한 시차로 반복). 서로 다른 사업선의 사례를 묶고, 공통 구조를 한 문장으로 일반화한 뒤, 그 구조가 회사 행동의 무엇을 말하는지 쓴다.",
    "패턴이 아닌 것: 한 사업의 단계 진척(톤급 → 10톤급, 건설 → 인증)은 시퀀스이지 패턴이 아니다. 단일 사건, 한 시점의 현황 요약, 과거 대 현재 대비도 패턴이 아니다. 사례가 한 사업선뿐이면 그 패턴은 쓰지 않는다.",
    "[사업선별 사건 순서]는 제목 어휘로 기계적으로 묶은 것이다. 묶음이 틀렸으면 사건 표로 바로잡고, 같은 구조가 두 사업선 이상에서 보이는 것만 패턴으로 쓴다. 이 보고서에서 사실은 반복 메커니즘의 사례로만 쓴다.",
    "쓰지 않는 것: 과거 대 현재 표(전략 방향의 일), 앞으로 갈릴 경로·관측 신호(분기점의 일). 시간 순서는 '이어졌다'·'앞섰다'로 쓴다.",
    "출력 골격:",
    "# 패턴 인사이트: (회사의 반복 행동 방식을 담은 결론형 제목)",
    "## 핵심 요약",
    "- (3~4줄. 첫 줄은 회사가 반복하는 행동 방식, 이어서 핵심 패턴의 결론과 한국 셀·소재사 함의를 한 줄씩.)",
    "## 패턴 1: (결론형 제목)",
    "**반복 구조:** (일반화한 한 문장. 예: 신소재를 '개발 → 생산능력 → 초기 출하 → 고객 확대' 순으로 12~18개월 안에 상업화한다)",
    "**사례:** 사업선마다 한 줄. `사업선 — YYYY-MM 사건 → YYYY-MM 사건 → …` 두 줄 이상. 모든 사건은 입력에 있어야 한다.",
    "**이 구조가 말하는 것:** 두세 문장. 회사의 우선순위·역량·한계 중 무엇이 드러나는지, 지금 가장 앞선 사업선은 어디인지.",
    "(패턴 2, 3도 같은 형식. 최대 3개, 성립하는 것이 하나면 하나만.)",
    "## Takeaway",
    "- (한국 셀·양극재·음극재 사업에 주는 의미 2~3줄.)",
    "## 근거",
  ].join("\n"),
  inflection_point: [
    "[선택한 보고서 용도: 전략 분기점 — Branch / Trigger / Consequence]",
    MODE_OVERRIDE,
    "질문: 어떤 조건이 향후 경로를 바꾸며, 무엇을 관찰해야 하는가?",
    "분석 단위는 '조건에 따라 회사의 역할·자원 배분·시장 지위가 질적으로 달라지는 지점'이다. [진행 단계 지도]에서 다음 단계가 남은 사업을 고르되, 진척 여부 자체가 아니라 그 결과로 회사의 위상이 어떻게 갈리는지를 분기로 삼는다.",
    "분기점이 아닌 것: '가동 대 지연', '확대 대 유지', '성공 대 실패'처럼 진행 여부만 나눈 것은 실행 현황 점검이지 분기점이 아니다. 좋은 분기: '반복 주문·대형 고객 채택이 이어지면 독립 성장축, 아니면 보조 포트폴리오'처럼 경로 이름에 회사의 지위·역할이 들어간다.",
    "경로는 예언이 아니다. 이미 관측된 움직임에서 바로 이어질 수 있는 두 갈래를 조건부로 쓴다. 성공 확률·미래 매출을 수치로 만들지 않는다. 이 보고서에서 사실은 경로를 가르는 선행 신호로만 쓴다.",
    "쓰지 않는 것: 과거 대 현재 표(전략 방향의 일), 여러 사업의 반복 구조(패턴의 일), 할 일 목록 형태의 확인 과제.",
    "출력 골격:",
    "# 전략 분기점: (기업이 서 있는 갈림길을 담은 결론형 제목)",
    "## 핵심 요약",
    "- (3~4줄. 첫 줄은 현재 위치, 이어서 핵심 분기점과 갈림 신호, 한국 셀·소재사 함의를 한 줄씩.)",
    "## 분기점 1: (결론형 제목)",
    "현재까지 진행된 경로 한두 문장(날짜·단계) 뒤에 표:",
    "| | 경로 A: (회사의 지위·역할이 들어간 이름) | 경로 B: (회사의 지위·역할이 들어간 이름) |",
    "| 가르는 조건과 조기 관측 신호 | … | … |",
    "| 자원 배분·시장 지위가 어떻게 달라지는가 | … | … |",
    "| 한국 셀·소재사에 주는 의미 | … | … |",
    "(분기점 2, 3도 같은 형식. 최대 3개.)",
    "## Takeaway",
    "- (한국 셀·양극재·음극재 사업에 주는 의미 2~3줄. 어느 신호를 보면 되는지 포함.)",
    "## 근거",
  ].join("\n"),
};

// 공통 지시문. 2026-09-11 사용자 지시로 전면 개정: 짧게, 사실을 근거로 한 해석만, takeaway 중심.
// 예전 지시문(A~E 목차·핵심 변화 카드·자체검수 목록)은 보고서를 길게 만들고 "판단할 수 없다" 문장을
// 낳았다. 근거가 없어 판단할 수 없는 논점은 아예 쓰지 않는 것이 규칙이다.
export const TIMELINE_REPORT_PROMPT = [
  "너는 중국 이차전지 산업 분석가다. 독자는 한국 배터리 셀·양극재·음극재 회사의 전략·시장·기술기획 담당자이며, 보고서를 다 읽고 공부할 시간이 없다.",
  "입력된 정량 시계열과 사건 표를 근거로, 사실에서 읽어 낸 해석을 짧게 쓰고 독자가 가져갈 takeaway를 남겨라.",
  "",
  "[분량]",
  "- 보고서 전체는 A4 한 장(본문 500단어 안팎)을 넘기지 않는다. 근거 절은 분량에서 뺀다.",
  "- 절마다 항목은 최대 3개, 항목마다 두세 문장. 같은 사실·결론을 두 번 쓰지 않는다.",
  "- 사실을 다시 나열하는 요약을 쓰지 않는다. 사실은 해석의 근거로만 인용한다.",
  "",
  "[근거]",
  "- 입력에 있는 사실·수치·출처만 쓴다. 없는 수치·사건·고객·거래를 만들지 않는다.",
  "- 해석 문장은 근거가 된 사실(시점·수치)을 같은 문장이나 바로 앞 문장에 담는다.",
  "- 근거가 없어 판단할 수 없는 논점은 쓰지 않는다. '판단할 수 없다'·'자료가 없다'·'확인이 필요하다'로 채우는 대신 그 논점을 뺀다. 골격의 절도 채울 근거가 없으면 제목만 남기지 말고 뺀다.",
  "- 자료가 없는 구간을 활동이 없거나 중단되었다고 해석하지 않는다.",
  "",
  "[수치와 시점]",
  "- 발표일, 실제 사건 발생일, 통계 대상 기간을 구분한다. 연간 실적을 반기 실적으로 바꾸지 않는다.",
  "- 같은 기간·같은 단위·같은 집계 범위끼리만 비교한다. 반기와 연간의 절대액을 직접 비교하거나 연율화하지 않는다.",
  "- 매출과 이익의 비교 가능한 절대값이 있으면 영업이익률 = 영업이익 ÷ 매출 × 100을 직접 계산해 '직접 계산'이라고 표시한다.",
  "- 계획 생산능력과 가동·생산 실적, 계약 규모와 실제 출하·매출, 제품 발표와 고객 채택을 구분한다. 계약·전략협력·MOU를 실제 출하·매출로 취급하지 않는다.",
  "- 시장점유율·업계 평균·경쟁사 동기간 자료가 없으면 '경쟁력 강화'·'업계 대비 우수'를 쓰지 않는다. 기업 자체의 개선과 시장·경쟁사 대비 개선을 구분한다.",
  "- 두 시점의 차이만으로 가속·둔화를 단정하지 않는다. %와 %p를 구분한다.",
  "",
  "[표현]",
  "- 결론을 먼저 쓰고 근거를 붙인다. 제목은 항목명이 아니라 무엇이 달라졌는지를 담은 문장으로 쓴다.",
  "- 핵심 요약은 3~4줄, 한 줄에 한 문장, 결론 먼저, 주체·수치·시점 포함. 요약만 읽어도 판단을 알 수 있어야 한다.",
  "- '판단할 수 없다'·'단정할 수 없다'·'확인되지 않았다'·'제한적이다' 같은 유보 문장과, '원문 미검증'·'첨부 표에 따른 해석' 같은 출처 면책 문장을 쓰지 않는다. 자료가 약하면 결론을 근거 범위까지 좁혀 단정형으로 쓰거나 그 논점을 뺀다.",
  "- 정책을 표준·문건 번호로 부르면 바로 뒤 괄호에 한국어 내용을 붙인다(예: GB 38031-2025(동력전지 안전요구 개정)).",
  "- 시간 순서를 인과로 쓰지 않는다. '~뒤에 ~가 이어졌다', '~조건이 된다'처럼 쓰고, 인과를 부정하는 면책 문장도 쓰지 않는다.",
  "- '확인이 필요하다', '지켜봐야 한다', '대응해야 한다' 같은 행동 지시·할 일 목록을 쓰지 않는다.",
  "- 투자 추천이나 기업 홍보 문서를 작성하지 않는다. 주가·목표주가·매수매도를 쓰지 않는다.",
  "- 한국어 문장에 한자를 섞지 않는다. 회사명은 제공된 한국어 표준명을 쓴다. '레이어', 'stock/flow', '[사실]' 같은 내부 표식을 본문에 쓰지 않는다.",
  "- 숫자는 '661GWh', '3,448억 위안', '+33.9%'처럼 단위와 함께 짧게 쓴다.",
  "",
  "[근거 절]",
  "- '## 근거' 아래에 본문에 실제로 쓴 사실만 '- 시점 · 사실 · 출처' 한 줄씩 적는다. 입력의 출처 링크는 그대로 보존한다.",
  "- 출처·원문·링크를 만들어내지 않는다. 링크가 없으면 '링크 미제공'이라고 쓴다.",
  "",
  "[출력]",
  "- 반환 형식은 Markdown이다. HTML을 출력하지 마라. 최종 결과에는 보고서만 출력한다.",
].join("\n");

const cellText = value => String(value || "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const GROUPS = [
  { layers: ["supply-performance", "investment-production"] },
  { layers: ["customer-commercialization", "regional-overseas"] },
  { layers: ["technology-material-chemistry", "technology-process-performance"] },
  { layers: ["technology-ip-standard", "technology-development"] },
];

// ── 정량 시계열 표 ──────────────────────────────────────────────────────────
// 방향은 숫자에서 먼저 읽힌다. 매출 3,620 → 4,237, 출하 475 → 661 같은 열이 있어야
// "이 회사가 어디로 가고 있는가"가 보이고, 사건은 그 방향을 설명하거나 뒤집는 근거가 된다.
// 이 표가 없던 동안 모델은 사건 조각만 받았고, 리포트는 나열에 머물렀다.
const REPORT_METRIC_LABELS = {
  revenue_total: "매출(억 위안)", operating_profit: "영업이익(억 위안)",
  net_profit_attr: "지배주주 순이익(억 위안)", net_profit_excl: "순이익·비경상 제외(억 위안)",
};
const VOLUME_KIND_LABEL = { shipment: "출하량", installed: "장착량", capacity: "생산능력" };
const VOLUME_ITEM_LABEL = {
  cathode_lfp: "인산철리튬 양극재", cathode_ncm: "삼원계 양극재", cathode_lco: "코발트산리튬",
  cathode_na: "나트륨 양극재", precursor: "전구체", cathode: "양극재", anode: "음극재",
  ess: "ESS 전지", power: "동력전지", cell: "리튬이온전지", battery: "전지(품목 미상)",
};
export function metricLabel(metric, unit) {
  if (REPORT_METRIC_LABELS[metric]) return REPORT_METRIC_LABELS[metric];
  const match = String(metric).match(/^(shipment|installed|capacity)_(?:(cum|plan)_)?(.+)$/);
  if (!match) return null;
  const [, kind, basis, item] = match;
  if (!VOLUME_ITEM_LABEL[item]) return null;
  const unitLabel = unit === "t" ? "만 톤" : unit || "";
  return `${VOLUME_KIND_LABEL[kind]}${basis === "cum" ? "(누적)" : basis === "plan" ? "(계획)" : ""} · ${VOLUME_ITEM_LABEL[item]}(${unitLabel})`;
}
function metricCell(row) {
  const value = Number(row.value);
  if (!Number.isFinite(value)) return "—";
  const shown = row.unit === "t"
    ? (value / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })
    : value.toLocaleString("ko-KR", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 });
  const yoy = row.yoy_pct ?? row.yoy_pct_stated;
  return yoy === null || yoy === undefined || !Number.isFinite(Number(yoy)) ? shown : `${shown} (${Number(yoy) > 0 ? "+" : ""}${Number(yoy).toFixed(1)}%)`;
}
// 열은 연간 몇 해 + 아직 연간이 안 나온 당해의 최신 누적 하나. 지난 해 반기값은 연간이 있으니 뺀다.
export function metricTable(rows, { years = 4, alternatives = [] } = {}) {
  const layout = metricTableLayout(rows, { years });
  if (!layout) return "";
  const { columns, byMetric } = layout;
  const order = metric => {
    const money = Object.keys(REPORT_METRIC_LABELS).indexOf(metric);
    if (money >= 0) return money;
    return /_(cum|plan)_/.test(metric) ? 200 : 100;
  };
  const head = `| 지표 | ${columns.map(column => /^\d{4}$/.test(column) ? `${column} 연간` : `${column.slice(0, 4)} ${column.slice(4)} 누적`).join(" | ")} |`;
  const lines = [...byMetric.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([metric, { unit, cells }]) => `| ${metricLabel(metric, unit)} | ${columns.map(column => cells.has(column) ? metricCell(cells.get(column)) : "자료 없음").join(" | ")} |`);
  // 원래 값은 바꾸지 않고, 웹 검증에서 나온 다른 출처의 서술을 표 아래에 따로 적는다.
  const conflicts = (alternatives || []).filter(alt => alt.target_kind === "metric" && columns.includes(alt.period) && metricLabel(alt.metric, byMetric.get(alt.metric)?.unit));
  const notes = conflicts.map(alt => `- 상충 근거 · ${metricLabel(alt.metric, byMetric.get(alt.metric)?.unit)} ${alt.period}: ${alt.claim_ko} (출처 ${alt.source_url}; 원래 값은 보고서 추출값이며 검증 수준이 더 높다)`);
  return [head, `| --- | ${columns.map(() => "---").join(" | ")} |`, ...lines, ...(notes.length ? ["", "다른 출처가 원래 값과 다르게 적은 칸:", ...notes] : [])].join("\n");
}

// 표에 실제로 들어가는 칸. 웹 검증기가 교정할 칸을 키로 짚을 수 있도록 같은 목록을 넘긴다.
export function metricTableCells(rows, { years = 4 } = {}) {
  const layout = metricTableLayout(rows, { years });
  if (!layout) return [];
  return [...layout.byMetric.entries()].flatMap(([metric, { unit, cells }]) =>
    layout.columns.map(period => ({ period, metric, unit, label: metricLabel(metric, unit), value: cells.get(period)?.value ?? null })));
}

function metricTableLayout(rows, { years }) {
  const usable = (rows || []).filter(row => metricLabel(row.metric, row.unit) && /^\d{4}(H[12]|Q[1-4])?$/.test(String(row.period)));
  if (!usable.length) return null;
  const annualYears = [...new Set(usable.filter(row => /^\d{4}$/.test(row.period)).map(row => row.period))].sort().slice(-years);
  const lastAnnual = annualYears.at(-1) || "0000";
  // 최신 누적은 결산월로 고른다. 문자열로 정렬하면 "2026H1" < "2026Q1"이라 3월(Q1)이 6월(H1)보다
  // 뒤로 뽑힌다 — 실제로 그렇게 나와서 잡은 버그다.
  const endMonth = period => ({ Q1: 3, H1: 6, Q3: 9, Q4: 12, H2: 12 }[period.slice(4)] || 0);
  const interim = usable
    .filter(row => !/^\d{4}$/.test(row.period) && row.period.slice(0, 4) > lastAnnual)
    .map(row => row.period)
    .sort((a, b) => a.slice(0, 4).localeCompare(b.slice(0, 4)) || endMonth(a) - endMonth(b))
    .at(-1);
  const columns = interim ? [...annualYears, interim] : annualYears;
  if (!columns.length) return null;
  const byMetric = new Map();
  for (const row of usable) {
    if (!columns.includes(row.period)) continue;
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, { unit: row.unit, cells: new Map() });
    byMetric.get(row.metric).cells.set(row.period, row);
  }
  return { columns, byMetric };
}

function layerTable(events) {
  // 오래된 것이 위, 최근이 아래. 방향은 시간 순서대로 읽어야 보인다.
  const firstDate = new Map();
  for (const event of events) {
    const key = event.period || event.date;
    if (!firstDate.has(key) || String(event.date) < firstDate.get(key)) firstDate.set(key, String(event.date));
  }
  const periods = [...firstDate.keys()].sort((a, b) => firstDate.get(a).localeCompare(firstDate.get(b)));
  const rows = periods.map(period => {
    const cells = GROUPS.map(group => events
      .filter(event => (event.period || event.date) === period && group.layers.includes(event.layer))
      // 이벤트 UUID는 넣지 않는다. 넣으면 지시문의 "ID가 제공되면 보존한다"에 따라 모델이
      // 본문 문장 안에 [a45f53f5-…] 같은 식별자를 그대로 옮겨 적는다. 날짜와 출처 링크로 충분하다.
      // 기사 발행일이 있으면 사건 시점과 나란히 적는다. 회고 기사(9월 기사가 3월 발표를 다룸)를 구분하게 한다.
      .map(event => cellText(event.title) + " — " + cellText(event.fact) + " (" + (event.sourceDate ? "사건 " + cellText(event.date) + " · 발행 " + cellText(event.sourceDate) : cellText(event.date)) + (event.entity ? " · 발생 법인: " + cellText(event.entity) : "") + " · 출처: " + cellText(event.sourceName) + (event.sourceUrl ? ", " + event.sourceUrl : ", 링크 미제공") + ")")
      // 셀 구분에 <br>을 쓰면 모델이 그 태그를 그대로 따라 뱉고, 화면에는 글자 "<br>"이 보인다.
      .join(" / ") || "—");
    return "| " + cellText(period) + " | " + cells.join(" | ") + " |";
  });
  return ["| 시점 | 시장-실적/생산기반 | 시장-고객/해외 | 기술-소재/공정 | 기술-IP/인증/양산 |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

// 화면에는 보조 데이터를 포함해 많은 사건을 그대로 보이되, 모델에는 연도 흐름을 보존한
// 대표 근거만 넘긴다. 먼저 모든 연도·레이어를 남기고, 남은 예산에서 실제 실행 단계가
// 바뀐 사건을 우선한다. 발표·예정·MOU 성격의 반복 사건은 예산이 부족할 때 먼저 빠진다.
// 이 선택은 화면의 원시 이벤트를 바꾸지 않는다.
function eventPriority(event) {
  const text = `${event?.title || ''} ${event?.fact || ''}`;
  let score = 0;
  if (/(출하|인도|양산|대량 공급|탑재|가동|준공|상업 운전|리콜|누액|화재|품질|소송)/.test(text)) score += 4;
  if (/(수주|지정|인증|검증|고객)/.test(text)) score += 2;
  if (/(예정|계획|협약|MOU|발표|착공|달성)/.test(text)) score -= 1;
  return score;
}

const byPriorityThenDate = (a, b) => eventPriority(b) - eventPriority(a)
  || String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));

const isTechEvent = event => event?.track === "tech" || event?.track === "technology";
const evidenceKey = event => event.id || `${event.date}\u0000${event.title}`;
const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));

export function selectTimelineEvidence(events, { limit = 48, perBucket = 2 } = {}) {
  const ordered = [...(events || [])].sort(byDate);
  if (ordered.length <= limit) return ordered;
  const picked = pickRepresentatives(ordered, { limit, perBucket });
  const fixedKeys = new Set(picked.fixed.map(evidenceKey));
  let chosen = picked.chosen;
  // 대표만 고르면 레이어 정보가 없는 입력에서 연도 수만큼만 남는다(2026-09-10 후난위넝 비교 리포트:
  // 화면 62건 중 4건). 남는 칸은 실행 단계가 높은 사건으로 채운다.
  const chosenKeys = new Set(chosen.map(evidenceKey));
  const leftovers = ordered.filter(event => !chosenKeys.has(evidenceKey(event))).sort(byPriorityThenDate);
  chosen = [...chosen, ...leftovers.slice(0, Math.max(0, limit - chosen.length))];
  // 우선순위 어휘(출하·양산·고객)는 시장 사건에 몰려 있어 기술 사건이 계속 밀린다. 기술 몫을 보장한다.
  const techQuota = Math.min(ordered.filter(isTechEvent).length, Math.max(2, Math.floor(limit / 4)));
  let techCount = chosen.filter(isTechEvent).length;
  if (techCount < techQuota) {
    const keys = new Set(chosen.map(evidenceKey));
    const techPool = ordered.filter(event => isTechEvent(event) && !keys.has(evidenceKey(event))).sort(byPriorityThenDate);
    const removable = chosen.filter(event => !isTechEvent(event) && !fixedKeys.has(evidenceKey(event))).sort(byPriorityThenDate).reverse();
    while (techCount < techQuota && techPool.length && removable.length) {
      const drop = evidenceKey(removable.shift());
      chosen = [...chosen.filter(event => evidenceKey(event) !== drop), techPool.shift()];
      techCount += 1;
    }
  }
  return chosen.sort(byDate);
}

const isInProgressEvent = event => /(예정|계획|추진|검토|건설|착공|인증|검증|지정|시험|파일럿|협력|MOU|수주)/.test(`${event?.title || ""} ${event?.fact || ""}`);

// 세 모드가 제목만 다른 보고서가 되지 않게, 패턴은 연결 신호를 넓히고 분기점은 진행 중인 사건을 보강한다.
export function selectTimelineReportEvidence(events, reportMode = "direction") {
  const ordered = [...(events || [])].sort(byDate);
  if (reportMode === "direction") return selectTimelineEvidence(ordered, { limit: 24, perBucket: 1 });
  if (reportMode === "pattern") return selectTimelineEvidence(ordered, { limit: 32, perBucket: 2 });
  const selected = selectTimelineEvidence(ordered, { limit: 24, perBucket: 1 });
  const selectedKeys = new Set(selected.map(evidenceKey));
  const inProgress = ordered.filter(isInProgressEvent).sort(byPriorityThenDate).slice(0, 10);
  return [...selected, ...inProgress.filter(event => !selectedKeys.has(evidenceKey(event)))].sort(byDate).slice(-32);
}

// ── 용도별 입력 보조표 ──────────────────────────────────────────────────────
// 세 용도가 같은 사건 표만 받으면 모델이 같은 모양으로 읽는다. 용도마다 분석 단위를 먼저 보여 주는
// 표를 하나씩 붙인다. 모두 입력 사건을 재배열한 것일 뿐 새 사실을 만들지 않는다.
const GROUP_LABELS = ["시장-실적/생산기반", "시장-고객/해외", "기술-소재/공정", "기술-IP/인증/양산"];
const groupIndex = event => GROUPS.findIndex(group => group.layers.includes(event.layer));
const yearOf = event => String(event.date || "").slice(0, 4);
const monthIndex = date => { const [y, m] = String(date || "").split("-").map(Number); return y * 12 + (m || 1) - 1; };
const brief = event => `${cellText(event.title).slice(0, 70)} (${cellText(event.date)})`;

// 전략 방향: 축별로 가장 오래된 연도와 최근 연도의 대표 사건을 나란히 둔다.
export function baselineTable(events) {
  const rows = GROUPS.map((group, index) => {
    const own = events.filter(event => groupIndex(event) === index).sort(byDate);
    if (own.length < 2) return null;
    const first = yearOf(own[0]); const last = yearOf(own.at(-1));
    if (first === last) return null;
    const pick = year => own.filter(event => yearOf(event) === year).sort(byPriorityThenDate).slice(0, 2).map(brief).join(" / ");
    return `| ${GROUP_LABELS[index]} | ${first}: ${pick(first)} | ${last}: ${pick(last)} |`;
  }).filter(Boolean);
  if (!rows.length) return "";
  return ["| 축 | 가장 오래된 연도 | 최근 연도 |", "| --- | --- | --- |", ...rows].join("\n");
}

// 패턴: 서로 다른 축에서 1~18개월 간격으로 나온 사건 중 제목 단어가 겹치는 쌍. 후보일 뿐이다.
const STOP_TOKENS = new Set(["발표", "계획", "공시", "기록", "달성", "관련", "추진", "진행", "확대", "증가", "감소", "연간", "반기", "분기", "누적", "기준", "규모", "사업", "회사", "그룹", "중국", "전년", "대비", "억", "위안", "만", "톤", "개시", "체결"]);
const tokensOf = event => new Set((cellText(`${event.title} ${event.fact}`).match(/[가-힣A-Za-z0-9]{2,}/g) || [])
  .map(token => token.toLowerCase()).filter(token => !STOP_TOKENS.has(token) && !/^\d+$/.test(token)));
export function linkCandidates(events, { limit = 10 } = {}) {
  const usable = events.filter(event => groupIndex(event) >= 0 && /^\d{4}-\d{2}/.test(String(event.date || ""))).sort(byDate);
  const tokens = new Map(usable.map(event => [event, tokensOf(event)]));
  const pairs = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const a = usable[i]; const b = usable[j];
      if (groupIndex(a) === groupIndex(b)) continue;
      const gap = monthIndex(b.date) - monthIndex(a.date);
      if (gap < 1 || gap > 18) continue;
      const shared = [...tokens.get(a)].filter(token => tokens.get(b).has(token));
      if (!shared.length) continue;
      pairs.push({ a, b, gap, shared });
    }
  }
  pairs.sort((x, y) => y.shared.length - x.shared.length || x.gap - y.gap);
  const lines = pairs.slice(0, limit).map(({ a, b, gap, shared }) =>
    `- ${String(a.date).slice(0, 7)} [${GROUP_LABELS[groupIndex(a)]}] ${cellText(a.title).slice(0, 70)} → (${gap}개월) → ${String(b.date).slice(0, 7)} [${GROUP_LABELS[groupIndex(b)]}] ${cellText(b.title).slice(0, 70)} · 겹친 단어: ${shared.slice(0, 3).join(", ")}`);
  return lines.join("\n");
}

// 패턴: 사건을 사업선(제품·화학계·지역·사업 부문)으로 묶어 시간순으로 늘어놓는다. 반복 구조는 사업선을
// 나란히 놓아야 보인다. 묶음은 제목·사실의 어휘로만 하므로 기계적이고, 모델에게 그렇게 밝힌다.
const BUSINESS_LINES = [
  ["나트륨이온", /(나트륨|钠)/], ["전고체·반고체", /(전고체|반고체|고체\s*전해질|固态|半固态)/], ["LMFP", /(LMFP|인산망간철|磷酸锰铁)/],
  ["LFP", /(LFP|인산철|磷酸铁锂)/], ["고니켈·삼원계", /(고니켈|삼원|NCM|NCA|하이니켈|三元)/], ["실리콘 음극", /(실리콘|硅)/],
  ["흑연 음극", /(흑연|石墨)/], ["ESS·에너지저장", /(ESS|에너지저장|저장전지|储能)/], ["동력전지", /(동력전지|동력\s*배터리|动力电池)/],
  ["해외 거점", /(해외|헝가리|모로코|인도네시아|스페인|독일|미국|유럽|태국|한국\s*공장|현지)/], ["전구체", /(전구체|前驱体)/],
];
export function businessLineOf(event) {
  const text = `${event?.title || ""} ${event?.fact || ""}`;
  return BUSINESS_LINES.find(([, pattern]) => pattern.test(text))?.[0] || "";
}
export function businessLineTable(events, { maxPerLine = 6 } = {}) {
  const lines = new Map();
  for (const event of [...events].sort(byDate)) {
    const line = businessLineOf(event);
    if (!line) continue;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(event);
  }
  const rows = [...lines.entries()].filter(([, own]) => own.length >= 2);
  if (rows.length < 2) return "";
  return rows.map(([line, own]) => {
    const stage = event => stageOf(event) || (/(출하|납품|공급\s*개시|양산)/.test(`${event.title} ${event.fact}`) ? "출하·양산" : "");
    const picked = own.length > maxPerLine ? [...own.slice(0, maxPerLine - 1), own.at(-1)] : own;
    return `- ${line} — ` + picked.map(event => `${String(event.date).slice(0, 7)} ${stage(event) ? `[${stage(event)}] ` : ""}${cellText(event.title).slice(0, 60)}`).join(" → ");
  }).join("\n");
}

// 분기점: 다음 단계가 남은 사건을 단계 이름과 함께 모은다. 단계 어휘는 명세 4.2를 따른다.
const STAGE_RULES = [
  ["시험생산", /(시험\s*생산|시생산|파일럿|试产)/], ["건설·생산 준비", /(건설|착공|공장|기지|설비)/],
  ["고객 지정·채택", /(지정|정점|채택|선정)/], ["검증·인증", /(인증|검증|테스트|시험)/],
  ["수주·공급계약", /(수주|공급\s*계약|계약)/], ["협약·MOU", /(협약|협력|MOU|합작)/], ["계획", /(예정|계획|추진|검토)/],
];
export function stageOf(event) {
  const text = `${event?.title || ""} ${event?.fact || ""}`;
  return STAGE_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "";
}
export function stageMapTable(events, { limit = 12 } = {}) {
  const rows = events.filter(isInProgressEvent).map(event => ({ event, stage: stageOf(event) })).filter(row => row.stage)
    .sort((a, b) => byDate(b.event, a.event)).slice(0, limit).sort((a, b) => byDate(a.event, b.event))
    .map(({ event, stage }) => `| ${cellText(event.date)} | ${stage} | ${cellText(event.title).slice(0, 90)} — ${cellText(event.fact).slice(0, 140)} |`);
  if (!rows.length) return "";
  return ["| 시점 | 도달 단계(제목·사실의 어휘로 분류) | 사건 |", "| --- | --- | --- |", ...rows].join("\n");
}

const MODE_READING = {
  direction: "읽는 순서: [기준 시점 대비표]와 정량 시계열에서 과거와 현재의 무게중심을 먼저 고정하고, 사건 표에서 그 이동을 만든 결정과 거스르는 신호를 찾아라.",
  pattern: "읽는 순서: [사업선별 사건 순서]에서 사업선마다 어떤 단계가 어떤 순서·시차로 나오는지 보고, 두 사업선 이상에서 같은 모양이 반복되면 그것을 패턴으로 써라. 한 사업선의 진척만 있는 것은 쓰지 마라. 정량 시계열은 반복 구조의 결과가 숫자에 나타났는지 볼 때만 쓴다.",
  inflection_point: "읽는 순서: [진행 단계 지도]에서 다음 단계가 남은 사업을 먼저 고르고, 사건 표와 정량 시계열로 그 사업의 현재 위치를 확정한 뒤 두 갈래를 써라.",
};
function modeAid(events, mode) {
  if (mode === "pattern") {
    const lines = businessLineTable(events);
    return ["[사업선별 사건 순서] 제목·사실의 제품·지역 어휘로 사건을 사업선으로 묶고 시간순으로 늘어놓은 것. 묶음은 기계적이라 틀릴 수 있다. 두 사업선 이상에서 같은 모양이 반복되는지 보라:", "", lines || "(둘 이상의 사업선으로 묶이는 사건 없음 — 사건 표에서 직접 묶는다)"];
  }
  if (mode === "inflection_point") {
    const table = stageMapTable(events);
    return ["[진행 단계 지도] 다음 단계가 남은 것으로 보이는 사건. 단계는 제목·사실의 어휘로 분류한 것이라 사건 사실로 다시 확인한다:", "", table || "(진행 중으로 분류된 사건 없음 — 사건 표에서 계획·건설·인증 단계를 직접 찾는다)"];
  }
  const table = baselineTable(events);
  return ["[기준 시점 대비표] 축별로 가장 오래된 연도와 최근 연도의 대표 사건:", "", table || "(축별로 두 연도 이상 비교할 사건 없음 — 정량 시계열로 대비한다)"];
}

function pickRepresentatives(ordered, { limit, perBucket }) {
  const years = new Map();
  const buckets = new Map();
  for (const event of ordered) {
    const year = String(event.date || event.period || '시점 미상').slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(event);
    const period = String(event.period || event.date?.slice(0, 4) || "시점 미상");
    const key = `${period}\u0000${String(event.layer || "기타")}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  }
  // 2023년 이후 연간 흐름을 절대 잃지 않도록 연도별 한 건을 먼저 고정한다.
  const representative = [ordered[0], ordered.at(-1), ...years.values()].map(rows => Array.isArray(rows) ? [...rows].sort(byPriorityThenDate)[0] : rows);
  for (const bucket of buckets.values()) {
    representative.push(...[...bucket].sort(byPriorityThenDate).slice(0, perBucket));
  }
  const unique = [...new Map(representative.map(event => [evidenceKey(event), event])).values()].sort(byDate);
  const fixed = [...new Map([ordered[0], ordered.at(-1), ...years.values()]
    .map(rows => Array.isArray(rows) ? [...rows].sort(byPriorityThenDate)[0] : rows)
    .map(event => [evidenceKey(event), event])).values()];
  if (unique.length <= limit) return { chosen: unique, fixed };
  // 연도별 대표 근거는 남긴 채, 나머지는 실행 단계가 높은 사건부터 채운다.
  const fixedKeys = new Set(fixed.map(evidenceKey));
  const rest = unique.filter(event => !fixedKeys.has(evidenceKey(event))).sort(byPriorityThenDate);
  return { chosen: [...fixed, ...rest.slice(0, Math.max(0, limit - fixed.length))], fixed };
}

// 지시문의 마지막 절이 요구하는 입력 항목을 그대로 라벨링해 넘긴다.
// 이전 회차 보고서와 기존 HTML은 이 경로에 없으므로 없다고 분명히 적는다 —
// 비워 두면 모델이 있다고 가정하고 없는 내용을 인용한다.
// 정량 표를 사건 표보다 먼저 둔다. 방향은 숫자에서 잡고 사건으로 설명하게 하려는 것이다.
export function buildTimelineInput({ companyName, reportMode = "direction", events, metrics = [], alternatives = [], policies = [], policyLinks = [] }) {
  const quant = metricTable(metrics, { alternatives });
  // 화면에는 모든 이벤트를 남기되, 모델에는 기간·레이어 대표 24건만 짧은 근거로 보낸다.
  // 이 예산은 긴 원문 발췌·URL 때문에 호출이 상류 시간 제한을 넘는 것을 막는다.
  const selectedEvents = selectTimelineReportEvidence(events, reportMode).map(event => ({
    ...event,
    title: cellText(event.title).slice(0, 120),
    fact: cellText(event.fact).slice(0, 260),
    sourceName: cellText(event.sourceName).slice(0, 80),
    sourceUrl: String(event.sourceUrl || '').slice(0, 220),
  }));
  // 정책은 이 회사 사건과 연결 경로가 판정된 것만 넣는다. 연결 없는 정책을 참고로 던지면
  // 모델이 전부 부록으로 밀어내고 본문 해석에는 쓰이지 않는다.
  const policySection = policyLinks.length ? [
    "",
    `이 회사와 연결 경로가 판정된 중국 정책 ${policyLinks.length}건(정책 시점 순). 경로는 회사 사건을 출발점으로 한 추론이며 사실이 아니다:`,
    "",
    linkedPolicyTable(policyLinks, policies),
  ] : [];
  return [
    "[입력 자료]",
    "",
    "분석 대상: " + companyName,
    "기준일: " + new Date().toISOString().slice(0, 10),
    "기간: 아래 표의 시점 범위와 같다.",
    "",
    "기존 보고서 또는 HTML: 없음",
    "이전 회차 보고서: 없음",
    "",
    MODE_READING[reportMode] || MODE_READING.direction,
    "사건 표는 위가 과거, 아래가 최근이다.",
    "",
    quant
      ? "정량 시계열(거래소 표준 손익 항목 + 정기보고서 원문에서 뽑은 물량. 괄호는 원자료에 적힌 전년 동기 대비):"
      : "정량 시계열: 없음",
    "",
    quant || "(없음)",
    "",
    `화면 이벤트 ${events.length}건 중 ${reportMode === "pattern" ? "연결 패턴 분석 근거" : reportMode === "inflection_point" ? "진행 중인 분기 분석 근거" : "기간·레이어별 대표 근거"} ${selectedEvents.length}건(입력 예산 내 압축, 과거 → 최근):`,
    "",
    layerTable(selectedEvents),
    "",
    ...modeAid(selectedEvents, reportMode),
    ...policySection,
    "이 표들에 없는 사실·수치·출처는 쓰지 마라. 출처 링크는 그대로 보존하라.",
    "이벤트 식별자는 제공하지 않았으므로 본문에 어떤 식별자도 만들어 넣지 마라.",
  ].join("\n");
}

// 유보 표현 고쳐 쓰기는 함수 한도(300초) 안에서 여유가 있을 때만 한다. deadline은 요청 시작 기준 시각이다.
const HEDGE_REWRITE_MS = 50000;

export async function buildTimelineReport({ companyName, reportMode = "direction", events, metrics = [], alternatives = [], policies = [], policyLinks = [], deadline = Infinity }) {
  const mode = TIMELINE_REPORT_MODES.includes(reportMode) ? reportMode : "direction";
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai_report",
    timeoutMs: 110000,
    schema: REPORT_SHAPE,
    // 공통 지시문이 요약·유보 표현 규칙을 이미 담고 있어 따로 붙이지 않는다(프롬프트 길이를 줄이려는 것).
    instructions: `${TIMELINE_REPORT_PROMPT}\n\n${REPORT_MODE_GUIDE[mode]}${policyLinks.length ? `\n\n${POLICY_ANALYSIS_RULE}` : ""}`,
    input: buildTimelineInput({ companyName, reportMode: mode, events, metrics, alternatives, policies, policyLinks }),
  });
  const draft = String(data.report_markdown_ko || "").trim();
  const hedge = Date.now() + HEDGE_REWRITE_MS < deadline
    ? await reduceHedges(draft, { timeoutMs: HEDGE_REWRITE_MS })
    : { markdown: draft, before: countHedges(draft), after: countHedges(draft), rewritten: false, skipped: "time_budget" };
  // 표준·문건 번호 뒤에 한국어 내용을 괄호로 붙인다(모델이 빠뜨려도).
  const markdown = annotatePolicyCodes(hedge.markdown, policyCodeGlossary([...historicalPolicies(), ...policies]));
  return { report: { markdown_ko: markdown }, model, hedge: { before: hedge.before, after: hedge.after, rewritten: hedge.rewritten, skipped: hedge.skipped || null } };
}
