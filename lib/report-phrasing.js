import { createJsonResponse } from "./llm-provider.js";

// ── 보고서 유보 표현 ────────────────────────────────────────────────────────
// 보고서 지시문에는 "단정하지 않는다", "~로 취급하지 않는다" 같은 금지 규칙이 많다. 모델은 이 규칙을
// "그 주장을 쓰지 않는다"가 아니라 "'단정할 수 없다'고 적는다"로 지켜서, 본문이 판단할 수 없다·
// 확인되지 않았다로 채워진다(2026-09-11 사용자 지적). 규칙을 지키는 방법을 명시하고, 서버가 결과를
// 세어 넘치면 해당 문장만 한 번 고쳐 쓰게 한다. 프롬프트만으로는 안 지켜진 전례가 있다(HANDOFF 09-07 한국어 강제).

export const REPORT_PHRASING_RULE = [
  "[유보 표현 규칙]",
  "금지 규칙(단정하지 않는다·격상하지 않는다·인과로 쓰지 않는다)은 그 주장을 쓰지 않는 것으로 지킨다. '판단할 수 없다', '단정할 수 없다', '확인되지 않았다', '알 수 없다', '확인이 필요하다', '추가 검토가 필요하다', '근거가 부족하다', '지켜봐야 한다', '제한적이다', '불확실하다'를 문장으로 적어서 지키지 않는다.",
  "자료가 약한 주제는 셋 중 하나로 처리한다. ① 현재 근거로 말할 수 있는 범위까지 결론을 좁혀 단정형으로 쓴다. ② 결론을 바꿀 관측을 조건으로 쓴다('후속 출하가 시작되면 평가의 중심은 준비 속도에서 고객 확장성으로 옮겨 간다'). ③ 사업적 의미가 없으면 그 논점을 쓰지 않는다.",
  "나쁜 예: '실제 출하 여부는 확인되지 않아 판단할 수 없다.' 좋은 예: '현재 움직임은 고객 채택 확대보다 생산 준비의 성격이 강하다.'",
  "인과 면책 문장도 쓰지 않는다. '시간 순서는 인과를 증명하지 않는다', '선후 관계를 인과로 단정할 수 없다', '인과관계는 확인되지 않았다' 같은 문장은 넣지 않는다. 인과를 주장하지 않는 동사로 쓰면 규칙이 지켜진다.",
  "나쁜 예: '다만 시간 순서는 제품 발표가 장착 확대를 유발했다는 인과를 증명하지 않는다.' 좋은 예: '제품 발표 뒤 3개 분기 안에 장착이 늘었다.'",
  "출처·검증 면책 문장도 쓰지 않는다. '이는 첨부 정책표의 연결 경로에 따른 해석이며', '개별 제품의 규정 충족 여부는 제시되지 않았다', '정책 원문은 독립 검증되지 않았다' 같은 문장은 넣지 않는다. 검증 상태와 해석 영역 표시는 화면이 한다.",
  "보고서 전체에서 판단 범위를 밝히는 문장은 결론의 의미를 실제로 바꾸는 곳에 한 번만 쓴다.",
].join("\n");

// 모든 보고서 맨 위의 핵심 요약(사용자 지정 2026-09-11). 시계열 보고서는 Markdown 절로,
// 비교·함의 종합 보고서는 summary_ko 필드로 받는다. 문구는 한 곳에서 관리한다.
export const REPORT_SUMMARY_RULE = "보고서 맨 위(제목 바로 아래)에 핵심 요약을 3~4줄 쓴다. 각 줄은 한 문장이며 결론을 먼저 쓰고, 판단의 근거가 되는 주체·수치·시점을 담는다. 줄마다 서로 다른 논점을 다루고, 본문 절의 순서와 맞춘다. 요약만 읽어도 보고서의 판단을 알 수 있어야 한다. 요약에는 유보·면책 문장을 넣지 않고, 본문에 없는 사실을 새로 넣지 않는다.";

// 세는 표현. 활용형을 함께 잡되, 부정이 아닌 일반 서술("확인된")은 잡지 않는다.
export const HEDGE_PATTERNS = [
  /판단(?:할|하기)\s*(?:수\s*)?(?:없|어렵)/g,
  /단정(?:할|하기)\s*(?:수\s*)?(?:없|어렵)/g,
  /확인(?:되지|하지)\s*(?:않|못)/g,
  /확인할\s*수\s*없/g,
  /알\s*수\s*없/g,
  /(?:추가\s*)?(?:확인|검토|점검)이\s*필요/g,
  /근거가\s*(?:부족|약하|없)/g,
  /지켜봐야/g,
  /불확실/g,
  /미확인/g,
  /제한적/g,
  // 인과 면책: "시간 순서는 …인과를 증명하지 않는다", "인과로 단정할 수 없다", "인과관계는 확인되지 않았다".
  /인과(?:관계)?(?:를|로|는|가|를\s*의미)?\s*(?:증명|입증|보여\s*주|의미하|단정|확정|볼\s*수)[^.。\n]{0,6}?(?:않|없|못|어렵)/g,
  // 출처·검증 면책: "원문은 독립 검증되지 않았다", "…에 따른 해석이며", "…는 제시되지 않았다".
  /검증되지\s*않/g,
  /(?:원문\s*)?미검증/g,
  /제시되지\s*않/g,
  /에\s*따른\s*해석/g,
];

// 부록(근거 목록·출처)은 세지 않는다. 판단 문장이 아니라 자료 목록이다.
function bodyOf(markdown) {
  const text = String(markdown || "");
  // \b는 한글 뒤에서 경계로 잡히지 않아 쓰지 않는다.
  const cut = text.search(/^#{1,3}\s*(?:근거|부록)(?=\s|$)/m);
  return cut >= 0 ? text.slice(0, cut) : text;
}

// 유보 표현이 든 문장 수. 한 문장에 표현이 둘이어도("확인되지 않아 판단할 수 없다") 한 번 센다.
export function countHedges(markdown) {
  return hedgeSentences(markdown).length;
}

// 유보 표현이 든 문장 목록. 고쳐 쓰기 호출에 대상으로 넘긴다.
export function hedgeSentences(markdown) {
  const sentences = bodyOf(markdown).split(/\n+|(?<=[.。!?])\s+/).map(line => line.trim()).filter(Boolean);
  return sentences.filter(sentence => HEDGE_PATTERNS.some(pattern => { pattern.lastIndex = 0; return pattern.test(sentence); }));
}

export const HEDGE_LIMIT = 3;
const REWRITE_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["report_markdown_ko"],
  properties: { report_markdown_ko: { type: "string" } },
};
const REWRITE_RULE = [
  "당신은 분석 보고서 편집자다. 입력 보고서에서 [고칠 문장]에 적힌 문장만 고쳐 쓰고, 나머지 문장·제목·표·수치·날짜·출처 링크·순서는 한 글자도 바꾸지 않고 그대로 돌려준다.",
  REPORT_PHRASING_RULE,
  "고칠 때 새 사실·수치·출처·고객·거래를 만들지 않는다. 계획·협약·수주를 출하·매출로 격상하지 않는다. 시간적 선후를 인과로 바꾸지 않는다. 고칠 문장이 판단에 기여하지 않으면 지운다. 반환 형식은 원래와 같은 Markdown 전체다.",
].join("\n");

// 유보 표현이 상한을 넘을 때만 한 번 고쳐 쓴다. 실패하거나 결과가 더 나쁘면 원문을 그대로 쓴다.
export async function reduceHedges(markdown, { timeoutMs = 50000, limit = HEDGE_LIMIT } = {}) {
  const before = countHedges(markdown);
  if (before <= limit) return { markdown, before, after: before, rewritten: false };
  const targets = hedgeSentences(markdown).slice(0, 20);
  try {
    const { data } = await createJsonResponse({
      name: "report_hedge_rewrite",
      provider: "openai_report",
      timeoutMs,
      schema: REWRITE_SHAPE,
      instructions: REWRITE_RULE,
      input: `[고칠 문장]\n${targets.map(sentence => `- ${sentence}`).join("\n")}\n\n[보고서]\n${markdown}`,
    });
    const next = String(data?.report_markdown_ko || "").trim();
    const after = countHedges(next);
    // 고쳐 쓴 결과가 원문보다 크게 짧아졌으면 표·절이 빠진 것으로 보고 버린다.
    if (!next || next.length < markdown.length * 0.7 || after >= before) return { markdown, before, after: before, rewritten: false };
    return { markdown: next, before, after, rewritten: true };
  } catch (error) {
    console.error("[REPORT_HEDGE_REWRITE_FAILED]", JSON.stringify({ message: error.message }));
    return { markdown, before, after: before, rewritten: false };
  }
}
