import { createJsonResponse } from "./llm-provider.js";

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};

// 사용자가 기업 분석 화면에서 지정한 리서치 방법과 출력 형식이다. 모델에는 이 지시문과
// 바로 아래의 실제 레이어별 표만 준다. 표 바깥의 일반 지식·웹 검색은 근거가 될 수 없다.
//
// 이 지시문은 사용자가 직접 쓴 것이다. 임의로 요약하거나 문장을 바꾸지 않는다.
// 반환 형식만 이 저장소에 맞춰 고정한다 — 화면이 Markdown을 렌더링하므로 Markdown으로 낸다.
export const TIMELINE_REPORT_PROMPT = [
  "너는 산업·시장 분석가이자 분석 보고서 편집자다.",
  "",
  "입력된 시계열 이벤트와 기존 보고서를 사용해,",
  "'사건과 수치를 정리한 보고서'를",
  "'시장의 변화와 다음 판단 기준을 읽을 수 있는 보고서'로 재구성하라.",
  "",
  "독자는 기업 전략·시장조사·기술기획 담당자다.",
  "투자 추천이나 기업 홍보 문서를 작성하지 않는다.",
  "",
  "기존 보고서의 사실·단위·출처·분석 범위는 보존하되,",
  "정보의 선택, 강조 순서, 분석 구조, 화면 구성은 개선하라.",
  "기존 표의 색상과 문장만 바꾸는 수준으로 작업하지 마라.",
  "",
  "",
  "[1. 보고서의 목적]",
  "",
  "독자가 첫 화면에서 다음 세 가지를 이해할 수 있어야 한다.",
  "",
  "① 지금 가장 중요한 변화는 무엇인가?",
  "② 과거와 비교해 무엇이 달라졌는가?",
  "③ 다음에 어떤 정보가 나오면 현재 판단을 유지하거나 바꿔야 하는가?",
  "",
  "본문에서는 다음을 설명한다.",
  "",
  "- 성장은 어느 사업·지역·제품에서 나타나는가?",
  "- 기술은 발표, 검증, 고객 채택, 양산, 출하, 실적 중",
  "  어느 단계까지 진행되었는가?",
  "- 확인된 변화가 시장 수요·공급·경쟁·제품 채택에",
  "  어떤 영향을 줄 수 있는가?",
  "",
  "자료가 없는 질문에 답을 만들어내지 않는다.",
  "모든 질문을 의무적으로 별도 섹션으로 만들 필요는 없다.",
  "",
  "",
  "[2. 핵심 변화 선정]",
  "",
  "핵심 변화는 최대 3개만 선정하라.",
  "자료가 부족하면 1~2개만 제시해도 된다.",
  "",
  "중요도는 다음을 고려해 판단하라.",
  "- 기존 방향에서 얼마나 달라졌는가?",
  "- 실제 사업에 영향을 줄 수 있는가?",
  "- 발표를 넘어 실행 단계로 진전되었는가?",
  "- 후속 관측이 이전 신호를 확인하거나 약화시켰는가?",
  "",
  "임의의 중요도 점수, 성공 확률, 가중치를 만들지 마라.",
  "이벤트 건수가 많다는 이유로 시장이 성장했다고 해석하지 마라.",
  "",
  "각 핵심 변화는 다음 구조로 작성하라.",
  "",
  "'이전 상태 → 현재 달라진 점 → 확인 근거",
  " → 시장에서의 의미 → 다음 확인 사항'",
  "",
  "헤드라인은 '기술 동향', '매출 현황' 같은 항목명이 아니라,",
  "무엇이 달라졌는지를 설명하는 문장으로 작성하라.",
  "",
  "'경쟁력 강화', '성장 기대', '주목 필요'라는 말로 끝내지 마라.",
  "어느 사업·고객·제품·지역에 어떤 경로로 영향을 줄 수 있는지",
  "구체적으로 설명하라.",
  "",
  "기업 한 곳의 자료만으로 산업 전체의 수요 전환이나",
  "경쟁사 대비 우위를 단정하지 마라.",
  "",
  "",
  "[3. 보고서 구성]",
  "",
  "A. 첫 화면: 이번 분석의 판단",
  "",
  "- 회사명과 함께, 가장 중요한 변화가 드러나는 제목을 작성한다.",
  "- 전체 판단은 2문장 이내로 작성한다.",
  "  첫 문장은 중요한 변화,",
  "  둘째 문장은 판단의 범위 또는 남은 핵심 질문이다.",
  "- 핵심 변화 카드를 최대 3개 배치한다.",
  "- 카드마다 다음을 포함한다.",
  "  · 결론형 제목",
  "  · 대표 수치 또는 사건 1~2개",
  "  · 시장적 의미 1문장",
  "- 수치를 제시할 때는 현재값만 크게 쓰지 말고,",
  "  비교 가능한 이전값·변화량·대상 기간을 함께 보여준다.",
  "- 첫 화면을 긴 지표표나 데이터 공백 목록으로 채우지 않는다.",
  "",
  "",
  "B. 변화의 흐름: 같은 시간축에서 읽기",
  "",
  "- 자료에 맞춰 3~6개의 주요 시점 또는 기간을 선정한다.",
  "- 시장·실적, 기술·제품, 고객·양산·출하,",
  "  공급능력·투자 등 필요한 축을 같은 시간축에 배치한다.",
  "- 정책·채용·특허는 실제 자료가 있고,",
  "  핵심 판단에 의미가 있을 때만 포함한다.",
  "- 모든 축을 의무적으로 채우지 않는다.",
  "- 각 구간에는 핵심 사건 1~2개만 배치한다.",
  "- 자료가 없는 구간은 '자료 없음'으로 표시한다.",
  "  활동이 없거나 중단되었다고 해석하지 않는다.",
  "",
  "정량 지표는 비교 가능한 자료가 있을 때 시각화한다.",
  "- 두 시점이면 전후 비교 또는 막대그래프를 사용한다.",
  "- 세 시점 이상이면 필요한 경우 선그래프를 사용한다.",
  "- 관측이 없는 기간의 값을 임의로 보간하지 않는다.",
  "- 단위나 집계 범위가 다른 지표는 별도 차트로 나눈다.",
  "- 기간·단위·출처를 표시한다.",
  "",
  "기술·사업 이벤트는 동일 제품·기술·사업을 추적할 수 있을 때만",
  "단계형 흐름으로 보여준다.",
  "",
  "'발표 → 검증 → 고객 채택 → 양산 → 실제 출하 → 실적 기여'",
  "",
  "이 중 확인된 단계만 표시한다.",
  "확인되지 않은 단계를 채워 넣지 않는다.",
  "시간상 선후 관계를 보여주는 화살표를",
  "인과관계의 증명처럼 사용하지 않는다.",
  "",
  "",
  "C. 시장에 미치는 의미: 핵심 논점 최대 3개",
  "",
  "첫 화면의 핵심 변화를 다음 구조로 확장한다.",
  "",
  "① 달라진 점: 과거와 현재의 차이",
  "② 확인 근거: 비교 가능한 수치 또는 사건",
  "③ 시장적 의미: 영향을 받을 대상과 가능한 작동 경로",
  "④ 판단의 한계: 대안 설명 또는 아직 확인되지 않은 연결",
  "",
  "첫 화면의 문장과 숫자를 그대로 반복하지 말고,",
  "여기서는 독자가 판단하는 데 필요한 해석을 추가한다.",
  "",
  "자료가 허용하면 다음을 구분한다.",
  "- 시장 자체의 성장과 기업 점유율 상승",
  "- 물량 성장과 수익성 개선",
  "- 제품 발표와 실제 고객 채택",
  "- 계획 생산능력과 가동·생산 실적",
  "- 계약 규모와 실제 출하·매출",
  "",
  "근거가 약한 원인 설명은 '가능한 해석'으로 표시한다.",
  "기업 전체 실적을 특정 신제품의 성과로 단정하지 않는다.",
  "",
  "",
  "D. 다음 판단을 바꿀 관측: 최대 4개",
  "",
  "현재의 핵심 해석과 직접 연결되는 항목만 선정한다.",
  "",
  "표는 다음 4열로 작성한다.",
  "'확인할 항목 / 현재 관측 / 판단이 바뀌는 조건 / 확인 시점·자료'",
  "",
  "관측 항목이 선행 신호인지, 실행 진척인지,",
  "결과 지표인지 구분한다.",
  "",
  "'계속 지켜본다' 대신,",
  "어떤 관측이 나오면 현재 해석이 지지되거나 약화되는지 쓴다.",
  "",
  "비교 기간과 사업 범위를 일치시킨다.",
  "근거 없는 성장률 기준, 실행 시한, 성공 확률을 만들지 않는다.",
  "관찰 시점을 분석상 제안하는 경우에는 '제안'이라고 표시한다.",
  "",
  "비공개 자료를 확인 가능한 것처럼 안내하지 않는다.",
  "특정 제품의 성공 여부를 전사 매출만으로 판정하지 않는다.",
  "",
  "",
  "E. 상세 근거: 접을 수 있는 부록",
  "",
  "다음 내용은 삭제하지 말고 부록으로 이동한다.",
  "- 전체 정량 지표표",
  "- 상세 사건 목록",
  "- 출처와 제공된 원문",
  "- 계산식과 지표 정의",
  "- 데이터 공백과 내부 불일치",
  "",
  "본문의 핵심 주장과 부록의 근거가 연결되게 한다.",
  "",
  "원문·URL·이벤트 ID가 제공되면 보존한다.",
  "외국어 원문을 인용할 때는 필요한 짧은 부분과",
  "한국어 번역을 함께 제시한다.",
  "",
  "원문이나 URL이 없으면 '원문 미제공',",
  "'출처 링크 미제공'으로 표시한다.",
  "출처·원문·링크를 만들어내지 않는다.",
  "",
  "중대한 불일치가 핵심 판단에 영향을 주면",
  "부록에만 숨기지 말고 해당 본문에도 표시한다.",
  "",
  "",
  "[4. 반드시 지킬 분석 규칙]",
  "",
  "① 원시 이벤트와 원출처가 있으면 우선 사용한다.",
  "기존 생성 보고서만 있으면 '입력 보고서 기재치'로 취급하며,",
  "원문 검증이 끝난 사실로 격상하지 않는다.",
  "",
  "② 발표일, 실제 사건 발생일, 통계 대상 기간을 구분한다.",
  "연간 실적을 발표 시점에 따라 반기 실적으로 바꾸지 않는다.",
  "",
  "③ 글로벌과 해외, 동력전지와 ESS, 셀과 시스템,",
  "매출과 판매량, 계획과 실적을 혼용하지 않는다.",
  "",
  "④ 원자료의 증감률과 표시된 수치로 계산한 증감률이 다르면",
  "둘을 구분하고 차이를 표시한다.",
  "확인 없이 반올림 탓으로 확정하거나 임의로 수정하지 않는다.",
  "비중 변화의 %와 %p를 구분한다.",
  "",
  "⑤ 두 시점의 차이만으로 성장 가속·둔화를 단정하지 않는다.",
  "성장 속도의 변화를 말할 때는 비교 가능한 기간별 근거가 필요하다.",
  "",
  "⑥ 매출 절대액 증가와 매출 비중 하락은 그 자체로 모순이 아니다.",
  "동일한 집계 기준인지 확인하고,",
  "전체·다른 부문의 성장과 구성비 변화를 구분한다.",
  "",
  "⑦ ESS 제품 출하를 동력전지 점유율 상승의 직접 근거로 쓰거나,",
  "서로 다른 제품의 발표와 실적을 하나의 상업화 경로로 묶지 않는다.",
  "",
  "⑧ 계약·전략협력·MOU를 실제 출하·매출로 취급하지 않는다.",
  "여러 해의 계약량을 연간 확정 실적으로 나누지 않는다.",
  "",
  "⑨ 데이터 부재와 반대 증거를 구분한다.",
  "후속 정보가 없다는 이유만으로 가설이 반증되었다고 쓰지 않는다.",
  "'모순'이나 '전환점'을 의무적으로 생성하지 않는다.",
  "",
  "⑩ 자료에 기재된 관측, 직접 계산, 분석적 해석,",
  "검증할 가설을 구분한다.",
  "이 구분과 원출처 확인 여부는 별개로 관리한다.",
  "",
  "",
  "[5. 표현과 화면 설계]",
  "",
  "긴 보고서에 요약 카드를 추가하는 것으로 끝내지 마라.",
  "핵심 본문을 줄이고 상세 정보를 부록으로 내려라.",
  "",
  "읽는 순서는 다음과 같다.",
  "'첫 화면 요약 → 변화의 흐름 → 시장적 의미",
  " → 다음 관측 → 상세 근거'",
  "",
  "모든 수치를 카드로 만들지 않는다.",
  "같은 사건을 결론·전환점·전파 경로에서 반복하지 않는다.",
  "본문 전체를 표로 구성하지 않는다.",
  "",
  "본문에서는 '레이어', 'stock/flow', '교차추론' 같은 용어보다",
  "독자가 바로 이해할 수 있는 표현을 사용한다.",
  "전문적인 정의와 검증 메모는 부록에 둔다.",
  "",
  "[사실], [교차추론] 등의 표식을 매 문장 앞에 반복하지 않는다.",
  "필요한 곳에 작은 라벨이나 근거 메모로 표시한다.",
  "",
  "제목, 핵심 수치, 본문, 주석의 시각적 위계를 분명히 한다.",
  "표를 넣기 위해 글자를 과도하게 줄이지 않는다.",
  "색상만으로 상태를 구분하지 말고 텍스트를 병기한다.",
  "모바일에서도 핵심 결론이 먼저 읽히게 한다.",
  "",
  "",
  "[6. 최종 출력]",
  "",
  "이 시스템의 반환 형식은 Markdown이다. HTML을 출력하지 마라.",
  "위 정보 구조를 제목·짧은 문단·제한된 표로 구현한다.",
  "지원하지 않는 카드나 차트를 구현했다고 가장하지 않는다.",
  "부록은 '## 부록' 제목 아래에 둔다.",
  "",
  "최종 결과에는 보고서만 출력한다.",
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
function metricLabel(metric, unit) {
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
export function metricTable(rows, { years = 4 } = {}) {
  const usable = (rows || []).filter(row => metricLabel(row.metric, row.unit) && /^\d{4}(H[12]|Q[1-4])?$/.test(String(row.period)));
  if (!usable.length) return "";
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
  if (!columns.length) return "";
  const byMetric = new Map();
  for (const row of usable) {
    if (!columns.includes(row.period)) continue;
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, { unit: row.unit, cells: new Map() });
    byMetric.get(row.metric).cells.set(row.period, row);
  }
  const order = metric => {
    const money = Object.keys(REPORT_METRIC_LABELS).indexOf(metric);
    if (money >= 0) return money;
    return /_(cum|plan)_/.test(metric) ? 200 : 100;
  };
  const head = `| 지표 | ${columns.map(column => /^\d{4}$/.test(column) ? `${column} 연간` : `${column.slice(0, 4)} ${column.slice(4)} 누적`).join(" | ")} |`;
  const lines = [...byMetric.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([metric, { unit, cells }]) => `| ${metricLabel(metric, unit)} | ${columns.map(column => cells.has(column) ? metricCell(cells.get(column)) : "자료 없음").join(" | ")} |`);
  return [head, `| --- | ${columns.map(() => "---").join(" | ")} |`, ...lines].join("\n");
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
      .map(event => cellText(event.title) + " — " + cellText(event.fact) + " (" + cellText(event.date) + " · 출처: " + cellText(event.sourceName) + (event.sourceUrl ? ", " + event.sourceUrl : ", 링크 미제공") + ")")
      // 셀 구분에 <br>을 쓰면 모델이 그 태그를 그대로 따라 뱉고, 화면에는 글자 "<br>"이 보인다.
      .join(" / ") || "—");
    return "| " + cellText(period) + " | " + cells.join(" | ") + " |";
  });
  return ["| 시점 | 시장-실적/생산기반 | 시장-고객/해외 | 기술-소재/공정 | 기술-IP/인증/양산 |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

// 지시문의 마지막 절이 요구하는 입력 항목을 그대로 라벨링해 넘긴다.
// 이전 회차 보고서와 기존 HTML은 이 경로에 없으므로 없다고 분명히 적는다 —
// 비워 두면 모델이 있다고 가정하고 없는 내용을 인용한다.
// 정량 표를 사건 표보다 먼저 둔다. 방향은 숫자에서 잡고 사건으로 설명하게 하려는 것이다.
export function buildTimelineInput({ companyName, events, metrics = [] }) {
  const quant = metricTable(metrics);
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
    "읽는 순서: 먼저 정량 시계열에서 이 회사가 어느 방향으로 움직이는지 잡고,",
    "그 다음 사건 표에서 그 방향을 만든 것과 흔드는 것을 찾아라.",
    "사건 표는 위가 과거, 아래가 최근이다.",
    "",
    quant
      ? "정량 시계열(거래소 표준 손익 항목 + 정기보고서 원문에서 뽑은 물량. 괄호는 원자료에 적힌 전년 동기 대비):"
      : "정량 시계열: 없음",
    "",
    quant || "(없음)",
    "",
    "원시 시계열 이벤트(레이어별 표, 과거 → 최근):",
    "",
    layerTable(events),
    "",
    "이 표에 없는 사실·수치·출처는 쓰지 마라. 출처 링크는 그대로 보존하라.",
    "이벤트 식별자는 제공하지 않았으므로 본문에 어떤 식별자도 만들어 넣지 마라.",
  ].join("\n");
}

export async function buildTimelineReport({ companyName, events, metrics = [] }) {
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai",
    timeoutMs: 85000,
    schema: REPORT_SHAPE,
    instructions: TIMELINE_REPORT_PROMPT,
    input: buildTimelineInput({ companyName, events, metrics }),
  });
  return { report: { markdown_ko: String(data.report_markdown_ko || "").trim() }, model };
}
