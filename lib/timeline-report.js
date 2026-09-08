import { createJsonResponse } from "./llm-provider.js";

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};

// 사용자가 기업 분석 화면에서 지정한 리서치 방법과 출력 형식이다. 모델에는 이 지시문과
// 바로 아래의 실제 레이어별 표만 준다. 표 바깥의 일반 지식·웹 검색은 근거가 될 수 없다.
export const TIMELINE_REPORT_PROMPT = [
  "# 역할",
  "",
  "너는 이차전지 산업 시장 리서처다. 아래 '레이어별 시계열 이벤트 테이블'을 읽고,",
  "단순 요약이 아니라 **전환점·인과 경로·선행지표**를 뽑아내는 분석 보고서를 작성한다.",
  "",
  "# 입력 데이터 구조",
  "",
  "- 행: 시점 (분기 또는 반기, 위가 최근 / 아래가 과거)",
  "- 열: 4개 레이어",
  "  · 시장-실적/생산기반 (매출, 이익, 출하량, Capa)",
  "  · 시장-고객/해외 (해외매출, 점유율, 수주, 파트너십)",
  "  · 기술-소재/공정 (제품 스펙, 양산 인도, 신규 셀)",
  "  · 기술-IP/인증/양산 (특허, 인증, 공장)",
  "- 각 셀은 개별 이벤트 + 원문 출처 링크",
  "",
  "# 데이터 해석 규칙 (위반 시 결과 무효)",
  "",
  "1. **stock vs flow 구분**: 특허 보유·출원 건수, 누적 Capa 등은 누적치다.",
  "   반드시 구간 증분(Δ)으로 변환한 뒤 해석하라. 절대값 나열은 금지.",
  "2. **기간 정규화**: 반기·분기·\"1~5월\" 등 단위가 혼재한다.",
  "   동일 기간끼리만 비교(YoY 우선)하고, 이종 기간을 연환산해 비교하지 마라.",
  "   비교 불가한 쌍은 \"비교불가\"로 명시.",
  "3. **결측(—) 처리**: 빈 셀은 '사건 부재'가 아니라 '데이터 공백'이다.",
  "   결측을 근거로 감소·정체·중단을 주장하지 마라. 별도 공백 목록으로만 보고.",
  "4. **절대값과 비중 분리**: 해외매출 금액과 매출 비중은 다른 신호다.",
  "   비중 변화가 분자(해외 성장) 때문인지 분모(내수 부진) 때문인지 판별하고,",
  "   판별 불가면 두 시나리오를 병기하라.",
  "5. **출처 편향 보정**: 기업 자사 발표(IR·보도자료)는 선별 공시 가능성이 있다.",
  "   자사발 지표는 근거등급을 한 단계 낮추고, 제3자 검증 필요 항목을 표시하라.",
  "6. **상관 ≠ 인과**: 기술 이벤트와 시장 성과를 연결할 때는",
  "   (a) 시차 (b) 물리적/상업적 메커니즘 (c) 반증 가능성을 함께 제시하라.",
  "   셋을 못 채우면 \"상관 관찰\"로만 기술하라.",
  "7. **표기 등급**: 모든 문장에 다음 중 하나를 붙인다.",
  "   [사실] 원문에 직접 기재 / [추론] 1개 데이터에서 도출 /",
  "   [교차추론] 2개 이상 레이어 결합 / [가설] 근거 부족, 검증 필요",
  "",
  "# 분석 절차 (순서대로 수행)",
  "",
  "STEP 1. 정량 지표를 시점별 표로 재구성하고 Δ와 증감률을 계산한다.",
  "STEP 2. **전환점 탐지** — 증감률이 꺾이거나, 성장 동인이 바뀌거나,",
  "새 사업 축(예: 신규 응용처·신규 화학)이 처음 등장한 시점을 찾는다.",
  "STEP 3. **레이어 간 lead-lag 분석** — 기술 레이어 이벤트가 몇 분기 뒤",
  "시장 레이어 숫자로 나타나는지 추적한다. 전파되지 않은 기술 이벤트도",
  "똑같이 중요하게 다뤄라(양산 실패 또는 시차 진행 중 신호).",
  "STEP 4. **정합성 검증** — 레이어 간 모순되는 신호를 찾아라.",
  "예: Capa 증설 ↔ 출하 증가율 둔화, 인증 취득 ↔ 매출 미반영.",
  "모순은 숨기지 말고 별도 섹션으로 드러내라.",
  "STEP 5. **선행지표 도출** — 향후 2~4분기에 무엇을 관찰하면 이 해석이",
  "맞았는지/틀렸는지 판정되는지, 관찰 대상과 판정 기준을 특정하라.",
  "",
  "# 출력 형식 (표 중심, 서론·유보사항 나열 금지)",
  "",
  "## 1. 핵심 결론",
  "",
  "불릿 3개 이내. 각 문장에 등급 태그. 숫자 포함 필수.",
  "",
  "## 2. 정량 지표 시계열",
  "",
  "| 지표 | 시점A | 시점B | Δ | 증감률 | 단위/성격(stock·flow) | 등급 |",
  "",
  "## 3. 전환점",
  "",
  "| 시점 | 레이어 | 사건 | 왜 전환점인가 | 등급 |",
  "",
  "## 4. 기술 → 시장 전파 경로",
  "",
  "| 기술 이벤트(시점) | 시차 | 대응 시장 결과(시점) | 메커니즘 | 반증 조건 | 등급 |",
  "",
  "## 5. 레이어 간 모순 / 미해소 신호",
  "",
  "| 신호A | 신호B | 왜 상충하는가 | 가능한 해석 2개 |",
  "",
  "## 6. 향후 검증용 선행지표",
  "",
  "| 관찰 대상 | 예상 시점 | 판정 기준(구체 수치) | 확인 가능한 소스 유형 |",
  "",
  "## 7. 데이터 공백",
  "",
  "결측 구간과, 그 공백 때문에 확정할 수 없는 판단을 명시.",
  "",
  "# 금지",
  "",
  "- \"성장하고 있다\", \"주목된다\" 같은 무내용 서술",
  "- 원문에 없는 수치 생성 (모르면 \"미확인\")",
  "- 결측을 근거로 한 추세 주장",
  "- 서론·면책·\"추가 조사가 필요합니다\" 류 마무리 문장",
  "- 주가·매수매도·목표주가·투자 추천·행동 지시",
].join("\n");

const cellText = value => String(value || "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const GROUPS = [
  { layers: ["supply-performance", "investment-production"] },
  { layers: ["customer-commercialization", "regional-overseas"] },
  { layers: ["technology-material-chemistry", "technology-process-performance"] },
  { layers: ["technology-ip-standard", "technology-development"] },
];

function layerTable(events) {
  const periods = [...new Set(events.map(event => event.period || event.date))].sort((a, b) => String(b).localeCompare(String(a)));
  const rows = periods.map(period => {
    const cells = GROUPS.map(group => events
      .filter(event => (event.period || event.date) === period && group.layers.includes(event.layer))
      .map(event => "[" + event.id + "] " + cellText(event.title) + " — " + cellText(event.fact) + " (출처: " + cellText(event.sourceName) + (event.sourceUrl ? ", " + event.sourceUrl : ", 링크 미제공") + ")")
      .join("<br>") || "—");
    return "| " + cellText(period) + " | " + cells.join(" | ") + " |";
  });
  return ["| 시점 | 시장-실적/생산기반 | 시장-고객/해외 | 기술-소재/공정 | 기술-IP/인증/양산 |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

export async function buildTimelineReport({ companyName, events }) {
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai",
    timeoutMs: 85000,
    schema: REPORT_SHAPE,
    instructions: TIMELINE_REPORT_PROMPT,
    input: "회사: " + companyName + "\n\n# 레이어별 시계열 이벤트 테이블\n\n" + layerTable(events) + "\n\n표에 없는 사실·수치·출처는 쓰지 마라.",
  });
  return { report: { markdown_ko: String(data.report_markdown_ko || "").trim() }, model };
}
