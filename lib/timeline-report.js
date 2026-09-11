import { createJsonResponse } from "./llm-provider.js";
import { POLICY_ANALYSIS_RULE, annotatePolicyCodes, historicalPolicies, policyCodeGlossary } from './policy-context.js';
import { linkedPolicyTable } from './policy-links.js';
import { countHedges, reduceHedges } from './report-phrasing.js';

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};

// 2026-09-11 사용자 판단을 반영해 세 모드를 하나의 시계열 보고서로 합쳤다. 40~50개 팩트는
// 서로 다른 세 보고서의 얇은 근거가 아니라, 변화·반복·미결 변수를 한 흐름으로 읽는 한 묶음이다.
const UNIFIED_REPORT_GUIDE = [
  "[시계열 통합 분석]",
  "질문: 이 기업은 시계열상 무엇을 유지·확장·이동했고, 여러 독립 사례에서 어떤 실행 방식이 반복됐으며, 현재 판단을 앞으로 바꿀 수 있는 관측 가능한 변수는 무엇인가?",
  "세 관점을 아래 순서로 연결하되 같은 사실과 결론을 절마다 반복하지 마라.",
  "1. 전략 변화는 비교 가능한 과거와 현재를 대비해 유지·확장·중심 이동을 구분한다. 신규 사업 진입만 확인되면 확장으로 쓰고, 매출 비중·출하·생산능력·투자 규모의 상대 변화나 명시적 자원 재배분이 있을 때만 중심 이동으로 쓴다.",
  "2. 반복 실행 방식은 서로 독립된 제품·공장·지역·프로젝트 두 사례 이상에서 같은 구체적 선택이 확인될 때만 쓴다. 같은 프로젝트의 개발·착공·인증·출하는 하나의 사례이며, '개발 → 생산 → 출하' 같은 제조업의 일반 순서는 패턴이 아니다. 성립하는 패턴이 없으면 이 절을 뺀다.",
  "3. 핵심 변수는 이미 확인된 진행 상태에서 기업의 역할·자원 배분·고객 기반에 큰 영향을 줄 아직 미결인 항목이다. 미래를 두 개 시나리오로 나누지 마라. 각 변수마다 현재 확인된 사실, 왜 중요한지, 향후 시계열에서 확인할 수 있는 구체적 신호만 적는다. 신호가 없다는 사실을 실패나 반대 경로의 확정으로 쓰지 않는다.",
  "[기준 시점 대비 후보]·[사업선별 사건 순서]·[진행 상태 후보]는 기계적 읽기 보조자료일 뿐 결론의 증거가 아니다. 반드시 정량 시계열과 전체 사건 표에서 근거를 다시 확인한다.",
  "",
  "출력 골격:",
  "# 시계열 분석: (이 기업의 변화와 현재 위치를 한 문장으로 담은 결론형 제목)",
  "## 핵심 요약",
  "- (3~4줄. 전략의 현재 중심축, 가장 중요한 변화, 확인된 반복 실행 방식 또는 핵심 변수, 한국 셀·소재사 함의를 한 줄씩. 근거 없는 항목으로 줄 수를 채우지 않는다.)",
  "## 전략의 현재 위치와 변화",
  "| 변화 축 | 과거 (시점) | 현재 (시점) | 판단 |  ← 비교 가능한 축만 최대 3행. 판단은 유지·확장·중심 이동을 구분한다.",
  "표 뒤에 변화의 의미를 두세 문장으로 정리한다.",
  "## 반복해서 나타난 실행 방식",
  "성립하는 패턴만 최대 2개. 각 패턴은 '### 결론형 제목'과 서로 다른 독립 사례 최소 2개의 시점·사실, 공통 선택, 적용 범위를 두세 문장으로 쓴다. 성립하는 패턴이 없으면 절 전체를 뺀다.",
  "## 판단을 바꿀 핵심 변수",
  "최대 3개. 각 변수는 '### 변수 이름' 아래 **현재 확인된 사실:**, **왜 중요한가:**, **관측 신호:** 순으로 쓴다. 관측 신호는 반복 주문·고객 채택·가동·출하·투자 확정처럼 자료에서 직접 확인 가능한 사건이어야 하며 임의의 수치·확률·기한을 만들지 않는다.",
  "## 한국 배터리·소재사에 주는 의미",
  "- (관련 있는 셀·양극재·음극재 부문에 한정해 2~3줄. 유리·압박·중립 방향과 그 근거를 분명히 쓴다.)",
  "## 근거",
].join("\n");

// 공통 지시문. 2026-09-11 사용자 지시로 전면 개정: 짧게, 사실을 근거로 한 해석만, takeaway 중심.
// 예전 지시문(A~E 목차·핵심 변화 카드·자체검수 목록)은 보고서를 길게 만들고 "판단할 수 없다" 문장을
// 낳았다. 근거가 없어 판단할 수 없는 논점은 아예 쓰지 않는 것이 규칙이다.
export const TIMELINE_REPORT_PROMPT = [
  "너는 중국 이차전지 산업 분석가다. 독자는 한국 배터리 셀·양극재·음극재 회사의 전략·시장·기술기획 담당자이며, 보고서를 다 읽고 공부할 시간이 없다.",
  "입력된 정량 시계열과 사건 표를 근거로, 사실에서 읽어 낸 해석을 짧게 쓰고 독자가 가져갈 takeaway를 남겨라.",
  "",
  "[분량]",
  "- 보고서 전체 본문은 800단어 안팎을 넘기지 않는다. 근거 절은 분량에서 뺀다.",
  "- 절마다 항목은 최대 3개, 항목마다 두세 문장. 성립하는 항목이 하나면 하나만 쓴다. 같은 사실·결론을 두 번 쓰지 않는다.",
  "- 사실을 다시 나열하는 요약을 쓰지 않는다. 사실은 해석의 근거로만 인용한다.",
  "",
  "[근거]",
  "- 입력에 있는 사실·수치·출처만 쓴다. 없는 수치·사건·고객·거래를 만들지 않는다.",
  "- 해석 문장은 근거가 된 사실(시점·수치)을 같은 문장이나 바로 앞 문장에 담는다.",
  "- 확인된 사실을 연결해 사업적 의미를 추론할 수 있지만, 사건의 선후만으로 인과를 단정하지 않는다.",
  "- 근거가 없어 판단할 수 없는 논점은 쓰지 않는다. '판단할 수 없다'·'자료가 없다'·'확인이 필요하다'로 채우는 대신 그 논점을 뺀다. 골격의 절도 채울 근거가 없으면 제목만 남기지 말고 뺀다.",
  "- 자료가 없는 구간을 활동이 없거나 중단되었다고 해석하지 않는다.",
  "- 관측되지 않은 단계를 채워 넣지 않는다. 비교 대상이 없으면 업계 대비 우위나 기업만의 고유성을 주장하지 않는다.",
  "- 조건부 해석에서는 조건을 생략하지 않는다. 미래의 조건과 이미 확인된 사실을 분명히 구분한다.",
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
  "- 핵심 요약은 3~4줄, 한 줄에 한 문장, 결론 먼저, 주체·수치·시점 포함. 근거가 적으면 3줄로 쓰며 줄 수를 채우기 위해 논점을 만들지 않는다. 요약만 읽어도 판단을 알 수 있어야 한다.",
  "- 한국 사업에 주는 의미는 관련 있는 셀·양극재·음극재 부문에 한정한다. 모든 부문에 억지로 함의를 붙이지 않는다.",
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

// 통합 보고서는 화면의 40~50개 팩트를 한 번에 읽는다. 48건을 넘는 경우에만 연도·레이어와
// 기술 사건을 보존하는 공통 대표 근거 선택기를 적용한다.
export function selectTimelineReportEvidence(events) {
  return selectTimelineEvidence(events, { limit: 48, perBucket: 2 });
}

// ── 통합 입력 보조표 ────────────────────────────────────────────────────────
// 세 표는 같은 사건을 각각 변화·독립 사례·진행 상태 관점으로 재배열한 읽기 보조자료다.
// 어느 표도 그 자체로 결론의 증거가 아니며 전체 사건 표와 정량 시계열을 함께 확인해야 한다.
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

const UNIFIED_READING = "읽는 순서: 정량 시계열과 [기준 시점 대비 후보]로 전략 변화를 먼저 판단하고, 전체 사건 표와 [사업선별 사건 순서]에서 독립 사례의 반복 행동을 찾은 뒤, [진행 상태 후보]의 후속 사실을 대조해 아직 결론을 바꿀 수 있는 관측 변수를 고른다.";
function unifiedAids(events) {
  const baseline = baselineTable(events);
  const businessLines = businessLineTable(events);
  const stages = stageMapTable(events);
  return [
    "[기준 시점 대비 후보] 축별로 가장 오래된 연도와 최근 연도의 대표 사건. 같은 대상·기간·집계 범위인지 확인한 뒤 비교에 사용한다:",
    "",
    baseline || "(축별로 두 연도 이상 비교할 사건 없음 — 정량 시계열에서 비교 가능한 값만 쓴다)",
    "",
    "[사업선별 사건 순서] 제목·사실의 제품·지역 어휘로 묶은 사례 후보. 기계적 묶음이며 패턴의 증거가 아니다. 같은 프로젝트의 진행은 한 사례로 세고, 사건 표에서 서로 독립된 사례인지 다시 확인한다:",
    "",
    businessLines || "(둘 이상의 사업선 후보 없음 — 반복 실행 방식 절을 억지로 만들지 않는다)",
    "",
    "[진행 상태 후보] 다음 단계가 남은 것으로 보이는 사건. 이후 완료·변경 사건이 있는지 전체 사건 표에서 확인하며, 두 갈래 시나리오가 아니라 판단을 바꿀 관측 변수를 찾는 데만 사용한다:",
    "",
    stages || "(진행 상태 후보 없음 — 핵심 변수 절을 억지로 만들지 않는다)",
  ];
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
export function buildTimelineInput({ companyName, events, metrics = [], alternatives = [], policies = [], policyLinks = [] }) {
  const quant = metricTable(metrics, { alternatives });
  // 일반적인 기업 시계열 40~50건은 모두 보내고, 그보다 많을 때만 48건으로 압축한다.
  const selectedEvents = selectTimelineReportEvidence(events).map(event => ({
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
    UNIFIED_READING,
    "사건 표는 위가 과거, 아래가 최근이다.",
    "",
    quant
      ? "정량 시계열(거래소 표준 손익 항목 + 정기보고서 원문에서 뽑은 물량. 괄호는 원자료에 적힌 전년 동기 대비):"
      : "정량 시계열: 없음",
    "",
    quant || "(없음)",
    "",
    `화면 이벤트 ${events.length}건 중 시계열 통합 분석 근거 ${selectedEvents.length}건(${events.length > selectedEvents.length ? "입력 예산 내 압축, " : ""}과거 → 최근):`,
    "",
    layerTable(selectedEvents),
    "",
    ...unifiedAids(selectedEvents),
    ...policySection,
    "이 표들에 없는 사실·수치·출처는 쓰지 마라. 출처 링크는 그대로 보존하라.",
    "이벤트 식별자는 제공하지 않았으므로 본문에 어떤 식별자도 만들어 넣지 마라.",
  ].join("\n");
}

// 유보 표현 고쳐 쓰기는 함수 한도(300초) 안에서 여유가 있을 때만 한다. deadline은 요청 시작 기준 시각이다.
const HEDGE_REWRITE_MS = 50000;

export async function buildTimelineReport({ companyName, events, metrics = [], alternatives = [], policies = [], policyLinks = [], deadline = Infinity }) {
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai_report",
    timeoutMs: 110000,
    schema: REPORT_SHAPE,
    // 공통 지시문이 요약·유보 표현 규칙을 이미 담고 있어 따로 붙이지 않는다(프롬프트 길이를 줄이려는 것).
    instructions: `${TIMELINE_REPORT_PROMPT}\n\n${UNIFIED_REPORT_GUIDE}${policyLinks.length ? `\n\n${POLICY_ANALYSIS_RULE}` : ""}`,
    input: buildTimelineInput({ companyName, events, metrics, alternatives, policies, policyLinks }),
  });
  const draft = String(data.report_markdown_ko || "").trim();
  const hedge = Date.now() + HEDGE_REWRITE_MS < deadline
    ? await reduceHedges(draft, { timeoutMs: HEDGE_REWRITE_MS })
    : { markdown: draft, before: countHedges(draft), after: countHedges(draft), rewritten: false, skipped: "time_budget" };
  // 표준·문건 번호 뒤에 한국어 내용을 괄호로 붙인다(모델이 빠뜨려도).
  const markdown = annotatePolicyCodes(hedge.markdown, policyCodeGlossary([...historicalPolicies(), ...policies]));
  return { report: { markdown_ko: markdown }, model, hedge: { before: hedge.before, after: hedge.after, rewritten: hedge.rewritten, skipped: hedge.skipped || null } };
}
