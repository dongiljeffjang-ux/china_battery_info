import { createJsonResponse } from "./llm-provider.js";
import { POLICY_ANALYSIS_RULE } from './policy-context.js';
import { linkedPolicyTable } from './policy-links.js';

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};

export const TIMELINE_REPORT_MODES = ["direction", "pattern", "inflection_point"];

// 세 용도는 같은 시계열을 서로 다른 단위로 읽는다. 전략 방향은 "두 시점의 대비", 패턴은 "두 개 이상
// 사건의 연결", 분기점은 "진행 중 사건의 두 갈래"다. 공통 지시문(사용자 작성, 아래)은 자체 목차(A~E)와
// '핵심 변화 카드'를 갖고 있어서, 용도 절이 한 문단뿐이던 때는 세 보고서가 같은 모양으로 수렴했다.
// 그래서 용도 절이 공통 목차를 명시적으로 끄고, 용도마다 다른 출력 골격과 금지 사항을 준다.
// 공통 지시문 문장은 바꾸지 않는다.
const MODE_OVERRIDE = "이 절은 공통 지시문보다 우선한다. 공통 지시문의 [2. 핵심 변화 선정]의 카드 구조, [3. 보고서 구성]의 A~E 목차, '확인된 것 / 아직 모르는 것 / 다음 확인 지표' 묶음, [5]의 읽는 순서는 이 용도에서 쓰지 않는다. 공통 지시문의 [4. 반드시 지킬 분석 규칙]과 수치·단위·출처·원문 보존 규칙은 그대로 지킨다. 아래 골격의 제목을 그대로 쓰고, 골격에 없는 절을 만들지 마라.";

const REPORT_MODE_GUIDE = {
  direction: [
    "[선택한 보고서 용도: 전략 방향 — 두 시점의 대비로 무게중심 이동을 읽는다]",
    MODE_OVERRIDE,
    "질문: 이 기업은 지금 어디에 무게를 두고 있으며, 기준 시점과 비교해 무엇이 달라졌는가?",
    "분석 단위는 '과거 상태 대 현재 상태'다. 입력의 [기준 시점 대비표]와 정량 시계열에서 가장 오래된 비교 가능 시점과 최근 시점을 먼저 고정하고, 사업 믹스·제품/화학계·고객·지역·투자/생산 중 실제로 무게가 옮겨 간 축만 고른다.",
    "쓰지 않는 것: 사건을 시간순으로 이어 붙인 연결 서사(패턴 보고서의 일), 진행 중 사건의 갈림길(분기점 보고서의 일), 경로 A/B.",
    "출력 골격:",
    "# 전략 방향: (무게중심이 어디서 어디로 옮겨 갔는지를 담은 결론형 제목)",
    "> (전략 명제 한 문장. '○○에서 ○○로' 형태로 이동을 말한다.)",
    "## 과거 대 현재",
    "| 축 | 과거 (시점) | 현재 (시점) | 무엇이 달라졌나 |  ← 3~5행. 비교 가능한 수치나 사건을 칸에 넣고, 달라지지 않은 축은 넣지 않는다.",
    "## 방향을 만든 결정",
    "최대 3개. 각 항목은 '### 결론형 제목' 아래 두세 문장: 어떤 결정·실행이 있었고(날짜·수치), 그것이 무게중심을 어떻게 옮겼는지.",
    "## 이 방향을 흔드는 반대 흐름",
    "입력에 실제로 있는 역행 신호만 1~2개. 없으면 '관측된 반대 흐름 없음' 한 줄.",
    "## 한국 셀·소재사에 주는 의미",
    "옮겨 간 무게중심이 한국 셀·양극재·음극재 사업의 고객 요구·경쟁 조건에 주는 방향 최대 2개.",
    "## 근거",
  ].join("\n"),
  pattern: [
    "[선택한 보고서 용도: 패턴 인사이트 — 떨어진 사건 두 개 이상을 이어 새로 보이는 것을 찾는다]",
    MODE_OVERRIDE,
    "질문: 개별 사건만 읽을 때는 보이지 않던 연결은 무엇인가?",
    "분석 단위는 '연결'이다. 한 패턴은 서로 다른 레이어 또는 서로 떨어진 시점의 사건 두 개 이상으로 이루어진다. 단일 사건, 한 시점의 현황 요약, 과거 대 현재 대비표는 패턴이 아니다.",
    "패턴 유형은 네 가지다. 수렴(여러 레이어가 같은 방향으로 모임) / 선행-후행(한 사건 뒤에 다른 레이어 사건이 이어짐, 시차를 개월로 적는다) / 괴리(이어질 흐름이 끊기거나 반대로 감) / 전환(반복되던 행동이 최근 달라짐). 실제로 성립하는 것만 최대 3개.",
    "입력의 [레이어 간 연결 후보]는 날짜·단어가 겹치는 사건 쌍을 기계적으로 뽑은 것이다. 연결을 보장하지 않으니 같은 제품·공장·고객·기술로 이어지는 것만 쓰고, 후보에 없는 연결도 사건 표에서 직접 찾아도 된다.",
    "쓰지 않는 것: 전략 명제·과거 대 현재 표(전략 방향 보고서의 일), 경로 A/B와 갈림 신호(분기점 보고서의 일). 시간 순서를 인과로 쓰지 않는다 — '이어졌다', '앞섰다'로 쓴다.",
    "출력 골격:",
    "# 패턴 인사이트: (패턴들을 관통하는 연결을 담은 결론형 제목)",
    "> (관통하는 연결 두 문장 이내.)",
    "## 패턴 1: (결론형 제목)",
    "**유형:** 수렴 | 선행-후행 | 괴리 | 전환 중 하나",
    "**연결:** `YYYY-MM [레이어] 사건` → (N개월) → `YYYY-MM [레이어] 사건` → … 처럼 한 줄 사슬로 쓴다. 사슬의 모든 사건은 입력에 있어야 한다.",
    "**이 연결이 말하는 것:** 두세 문장. 사건 하나씩 볼 때는 안 보이던 것.",
    "**반대로 읽힐 수 있는 사실:** 입력에 있을 때만 한 줄.",
    "(패턴 2, 3도 같은 형식. 성립하는 패턴이 하나뿐이면 하나만 쓴다.)",
    "## 한국 셀·소재사에 주는 의미",
    "패턴이 한국 셀·양극재·음극재 사업에 주는 방향 최대 2개.",
    "## 근거",
  ].join("\n"),
  inflection_point: [
    "[선택한 보고서 용도: 전략 분기점 — 진행 중인 사건이 어느 두 갈래로 갈릴 수 있는지 읽는다]",
    MODE_OVERRIDE,
    "질문: 지금 진행 중인 변화가 어떤 경로로 갈릴 수 있으며, 각 경로는 무엇을 의미하는가?",
    "분석 단위는 '아직 끝나지 않은 사건'이다. 입력의 [진행 단계 지도]에서 계획·협약·수주·인증·고객 지정·건설·시험생산처럼 다음 단계가 남은 사업을 고르고, 이미 끝난 실적은 현재 위치를 설명하는 데만 쓴다.",
    "경로는 예언이 아니다. 이미 관측된 움직임에서 바로 이어질 수 있는 두 갈래(예: 예정대로 양산 진입 대 일정 지연·축소, 고객 확대 대 단일 고객 의존)를 조건부로 쓴다. 성공 확률·미래 매출을 수치로 만들지 않는다.",
    "쓰지 않는 것: 과거 대 현재 대비표(전략 방향 보고서의 일), 사건 사슬·패턴 유형(패턴 보고서의 일), 할 일 목록 형태의 확인 과제.",
    "출력 골격:",
    "# 전략 분기점: (기업이 서 있는 갈림길을 담은 결론형 제목)",
    "> (현재 위치 두 문장 이내. 무엇이 어디까지 진행됐고 무엇이 남았는지.)",
    "## 진행 단계 지도",
    "| 사업·제품·거점 | 도달한 단계 (시점) | 다음 단계 | 그 단계를 확인할 자료 |  ← 2~5행.",
    "## 분기점 1: (결론형 제목)",
    "현재까지 진행된 경로를 한두 문장으로 쓴 뒤 아래 표를 쓴다.",
    "| | 경로 A: (한 줄 이름) | 경로 B: (한 줄 이름) |",
    "| 무엇이 관측되면 이 경로인가 | … | … |",
    "| 기업 전략에 주는 의미 | … | … |",
    "| 한국 셀·소재사에 주는 의미 | … | … |",
    "**갈림 신호:** 두 경로를 가르는 가장 이른 관측 한두 개와, 그것이 나오면 판단이 어떻게 바뀌는지.",
    "(분기점 2, 3도 같은 형식. 최대 3개.)",
    "## 근거",
  ].join("\n"),
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
  "외부 독자가 회사를 처음 접해도 판단할 수 있도록, 작성 전에 다음 세 가지를 먼저 확정한다.",
  "- 확인된 것: 수치나 실행 사실로 확인되는 변화",
  "- 아직 모르는 것: 원인·지속성·사업 기여를 판단할 수 없는 부분",
  "- 다음 확인 지표: 현재 판단을 실제로 강화하거나 약화할 관측",
  "이 세 가지에 직접 기여하지 않는 정보는 본문에서 제외하거나 부록으로 이동한다.",
  "보고서 전체의 중심 결론은 하나의 문장으로 요약할 수 있어야 한다.",
  "'추가 확인이 필요하다'로 끝내지 말고, 무엇이 왜 미확인인지와 어떤 관측이 필요한지를 구체적으로 쓴다.",
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
  "A. 첫 화면: 결론과 판단 경계",
  "",
  "- 회사명과 함께, 가장 중요한 변화가 드러나는 제목을 작성한다.",
  "- 전체 판단은 2문장 이내로 작성한다.",
  "  첫 문장은 중요한 변화,",
  "  둘째 문장은 판단의 범위 또는 남은 핵심 질문이다.",
  "- 그 아래에 '확인된 것 / 아직 모르는 것 / 다음 확인 지표'를 제시한다.",
  "  각 항목은 최대 2개, 각 항목당 1~2문장으로 제한한다.",
  "- 핵심 변화 카드는 꼭 필요할 때만 최대 3개 배치한다.",
  "- 카드마다 다음을 포함한다.",
  "  · 결론형 제목",
  "  · 대표 수치 또는 사건 1~2개",
  "  · 시장적 의미 1문장",
  "- 수치를 제시할 때는 현재값만 크게 쓰지 말고,",
  "  비교 가능한 이전값·변화량·대상 기간을 함께 보여준다.",
  "- 첫 화면을 긴 지표표나 데이터 공백 목록으로 채우지 않는다.",
  "- 같은 수치나 사건을 종합 판단·세 항목·카드에서 반복하지 않는다.",
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
  "매출과 이익의 비교 가능한 절대값이 있으면 영업이익률 등 수익성 지표를 직접 계산한다.",
  "- 영업이익률 = 영업이익 ÷ 매출 × 100",
  "- 분자와 분모의 기간·단위·집계 범위가 같을 때만 계산한다.",
  "- 계산값에는 '직접 계산'이라고 표시하고 사용한 수치를 보존한다.",
  "- 이익 증가율이 매출 증가율보다 높다는 설명만으로 끝내지 말고 이익률 변화를 함께 제시한다.",
  "- 반기와 연간의 절대액을 직접 비교하거나 반기 수치를 임의로 연율화하지 않는다.",
  "- 제품 믹스·가격·원가 자료가 없으면 수익성 변화의 원인을 확정하지 않는다.",
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
  "⑪ 기업 자체의 개선과 시장·경쟁사 대비 개선을 구분한다.",
  "시장점유율, 업계 평균, 시장 성장률 또는 경쟁사의 동기간 비교 자료가 없으면",
  "'경쟁력 강화', '시장 지위 개선', '업계 대비 우수'라고 쓰지 않는다.",
  "비교 자료가 없으면 기업 자체 변화만 확인되며 시장 대비 성과는 판단할 수 없다고 한 번만 표시한다.",
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
  "한 수치나 사건은 원칙적으로 본문에서 한 번만 상세히 설명한다.",
  "첫 화면은 결론, 변화의 흐름은 시점과 단계, 시장적 의미는 새로운 해석, 다음 관측은 판단 조건만 담당한다.",
  "표현만 바꾼 동일 결론, 반복되는 데이터 공백, 삭제해도 판단이 달라지지 않는 문단은 제거하거나 부록으로 옮긴다.",
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
  "[6. 출력 전 자체검수]",
  "",
  "최종 출력 전에 다음을 확인하고, 하나라도 어기면 고친 뒤 출력한다.",
  "- 핵심 결론을 한 문장으로 말할 수 있는가?",
  "- 확인된 사실과 가능한 해석이 구분되는가?",
  "- 매출과 이익 자료가 있는데 이익률 분석을 빠뜨리지 않았는가?",
  "- 같은 수치·한계·결론을 두 번 이상 설명하지 않았는가?",
  "- 미검증이거나 기업 관련성이 약한 정책이 본문에서 과도한 비중을 차지하지 않는가?",
  "- 비교 자료 없이 경쟁우위를 주장하지 않았는가?",
  "- 다음 관측이 구체적인 지표·사건·자료로 정의되어 있는가?",
  "",
  "[7. 최종 출력]",
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
  pattern: "읽는 순서: 사건 표를 레이어를 가로질러 읽어라. [레이어 간 연결 후보]를 출발점으로 삼되, 같은 제품·공장·고객·기술로 이어지는지 사건 사실로 확인한 연결만 패턴으로 써라. 정량 시계열은 연결의 결과가 숫자에 나타났는지 볼 때만 쓴다.",
  inflection_point: "읽는 순서: [진행 단계 지도]에서 다음 단계가 남은 사업을 먼저 고르고, 사건 표와 정량 시계열로 그 사업의 현재 위치를 확정한 뒤 두 갈래를 써라.",
};
function modeAid(events, mode) {
  if (mode === "pattern") {
    const candidates = linkCandidates(events);
    return ["[레이어 간 연결 후보] 서로 다른 축에서 1~18개월 간격으로 나오고 제목·사실 단어가 겹치는 사건 쌍. 기계적 후보이며 연결을 보장하지 않는다:", "", candidates || "(후보 없음 — 사건 표에서 직접 찾는다)"];
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

export async function buildTimelineReport({ companyName, reportMode = "direction", events, metrics = [], alternatives = [], policies = [], policyLinks = [] }) {
  const mode = TIMELINE_REPORT_MODES.includes(reportMode) ? reportMode : "direction";
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai_report",
    timeoutMs: 110000,
    schema: REPORT_SHAPE,
    instructions: `${TIMELINE_REPORT_PROMPT}\n\n${REPORT_MODE_GUIDE[mode]}${policyLinks.length ? `\n\n${POLICY_ANALYSIS_RULE}` : ""}`,
    input: buildTimelineInput({ companyName, reportMode: mode, events, metrics, alternatives, policies, policyLinks }),
  });
  return { report: { markdown_ko: String(data.report_markdown_ko || "").trim() }, model };
}
