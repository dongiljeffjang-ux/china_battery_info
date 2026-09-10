// LLM 자동 판정(LLM-as-judge). 사람 판정과 같은 판정값·사유 태그를 쓰되, 저장은 evaluator를 나눠 한다.
//
// 두 가지를 판정한다. 화면의 두 탭과 같은 구분이다.
//   1. 청크 품질  — 청크 텍스트 하나만 보고 "근거로 쓸 만한가"
//   2. 검색 정밀도 — (질문, 근거) 쌍을 보고 "이 질문에 맞는 근거인가"
//
// 이 파일은 프롬프트와 스키마, 그리고 사람 판정과의 일치율 계산만 둔다.
// LLM 호출과 DB 접근은 호출자가 맡는다(순수 함수로 두어야 회귀 검사에서 네트워크 없이 돌릴 수 있다).
//
// 왜 사람 판정을 프롬프트에 넣지 않는가: 넣으면 일치율이 측정이 아니라 따라쓰기가 된다.
// 판정자는 사람이 무엇이라 했는지 몰라야 한다.

import { ISSUE_TAGS, VERDICTS } from "./rag-evaluation.js";

const VERDICT_IDS = VERDICTS.map((verdict) => verdict.id);

// 판정 기준을 사람이 읽는 라벨 그대로 프롬프트에 넣는다.
// 화면·저장·자동판정이 같은 목록을 쓰게 하려면 여기서도 lib 상수를 읽어야 한다.
function verdictGuide(subjectType) {
  const labelKey = subjectType === "chunk" ? "label_chunk" : "label_retrieval";
  return VERDICTS.map((verdict) => `- ${verdict.id}: ${verdict[labelKey]}`).join("\n");
}

function tagGuide(subjectType) {
  return ISSUE_TAGS[subjectType].map((tag) => `- ${tag.id}: ${tag.label}`).join("\n");
}

function schemaFor(subjectType) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "issue_tags", "reason_ko"],
    properties: {
      verdict: { type: "string", enum: VERDICT_IDS },
      issue_tags: {
        type: "array",
        items: { type: "string", enum: ISSUE_TAGS[subjectType].map((tag) => tag.id) },
      },
      // 사람이 뒤집을지 판단하려면 근거가 필요하다. 판정만 있으면 왜 그랬는지 확인할 수 없다.
      reason_ko: { type: "string" },
    },
  };
}

export const CHUNK_JUDGE_SCHEMA = schemaFor("chunk");
export const RETRIEVAL_JUDGE_SCHEMA = schemaFor("retrieval");

const COMMON_RULES = `
판정 규칙
- 너의 배경지식으로 사실 여부를 따지지 않는다. 주어진 텍스트 안에서만 판단한다.
- 확신이 서지 않으면 good이나 bad로 밀지 말고 partial을 쓴다.
- 사유 태그는 해당하는 것만 고른다. 없으면 빈 배열로 둔다. 억지로 채우지 않는다.
- reason_ko는 한국어 한 문장으로, 판정의 근거만 쓴다.`;

export function buildChunkJudgePrompt(chunk) {
  const instructions = `너는 중국 배터리 산업 지식베이스의 품질 검수자다.
아래 근거 조각(청크) 하나를 보고, 질의응답의 근거로 쓸 만한지 판정한다.

판정값
${verdictGuide("chunk")}

사유 태그
${tagGuide("chunk")}

무엇을 보는가
- 이 조각 안에 확인 가능한 사실이 들어 있는가. 목차·머리말·"자세한 내용은 아래 참조" 같은 껍데기면 no_fact다.
- 표기된 회사와 내용의 회사가 같은가. 다르면 wrong_company다.
- 한국어가 문장으로 성립하는가. 원문 번역이 깨졌으면 translation_error다.
- 문장이 중간에 끊겼으면 truncated다.
- 배터리·소재·전기차 산업과 무관하면 off_domain이다.
${COMMON_RULES}`;

  const input = [
    `[청크 종류] ${chunk.source_type || "미상"}`,
    `[표기된 회사] ${chunk.company_id || "없음"}`,
    `[매체] ${chunk.source_name || "없음"}`,
    `[발행일] ${chunk.published_at ? String(chunk.published_at).slice(0, 10) : "없음"}`,
    "",
    "[임베딩에 들어간 텍스트]",
    String(chunk.content_ko || "").slice(0, 4000),
  ].join("\n");

  return { instructions, input, schema: CHUNK_JUDGE_SCHEMA, name: "rag_chunk_judge" };
}

export function buildRetrievalJudgePrompt({ question, chunk, rank }) {
  const instructions = `너는 중국 배터리 산업 질의응답 시스템의 검색 품질 검수자다.
질문 하나와, 검색이 그 질문에 대해 돌려준 근거 하나를 본다.
이 근거가 그 질문에 답하는 데 쓸 만한지 판정한다.

판정값
${verdictGuide("retrieval")}

사유 태그
${tagGuide("retrieval")}

가장 중요한 규칙 — 근거는 모아서 쓴다
답변은 이런 근거 10건을 모아 만든다. 이 근거 하나가 질문 전체에 답할 필요는 없다.
답의 한 조각이라도 채우면 good이다. "이것만으로는 완전한 답이 안 된다"는 bad의 이유가 아니다.
예: "전고체 배터리를 하는 회사는?"에 A사의 전고체 개발 소식 하나가 올라오면 good이다.
    그 하나가 회사 전체 목록을 주지 못해도 목록의 한 줄이 되기 때문이다.

질문의 범위를 넓히거나 좁히지 마라
- 질문에 없는 회사·시점·조건을 만들어 붙이지 마라. 아래 [근거에 붙은 정보]는 근거를 설명하는
  메타데이터일 뿐 질문의 조건이 아니다. 질문이 회사를 말하지 않았으면 그 질문은 모든 회사를 묻는 것이다.
- wrong_company는 질문이 회사를 직접 짚었을 때만 쓴다. 질문에 회사 이름이 없으면 절대 쓰지 마라.
- stale은 질문이 시점을 직접 짚었을 때만 쓴다(예: 2019년, 2026년 상반기).

그 밖에
- 근거가 질문이 묻는 주제와 아예 다른 이야기면 off_topic이다.
- 주제는 맞지만 한 줄짜리라 답에 아무 내용도 보태지 못하면 too_thin이다. 내용이 있으면 쓰지 마라.
- 근거 자체의 문장 품질이 아니라 "이 질문에 보탬이 되는가"만 본다.
${COMMON_RULES}`;

  const input = [
    `[질문] ${question}`,
    `[이 근거의 검색 순위] ${rank}위`,
    "",
    "[근거에 붙은 정보 — 질문의 조건이 아니다]",
    `종류: ${chunk.source_type || "미상"} / 분류된 회사: ${chunk.company_id || "없음"} / 발행일: ${chunk.published_at ? String(chunk.published_at).slice(0, 10) : "없음"}`,
    "",
    "[근거 본문]",
    String(chunk.content_ko || "").slice(0, 4000),
  ].join("\n");

  return { instructions, input, schema: RETRIEVAL_JUDGE_SCHEMA, name: "rag_retrieval_judge" };
}

// 사람 판정과 LLM 판정의 일치율. 이 숫자가 낮으면 LLM 판정을 지표로 쓸 수 없다.
//
// 세 가지를 따로 센다. 하나로 뭉치면 "무엇이 어긋났는지"가 사라진다.
//   exact       — 세 값이 그대로 같은 비율
//   usable      — good/partial을 "쓸 수 있음" 한 덩어리로 볼 때의 일치율.
//                 실무에서 partial과 good의 경계는 사람끼리도 갈리므로 이쪽이 더 현실적이다.
//   bad_recall  — 사람이 bad라 한 것을 LLM이 bad로 잡은 비율.
//                 자동판정을 '선별기'로 쓸 때 가장 중요한 값이다. 이걸 놓치면 사람이 볼 기회가 없다.
export function judgeAgreement(pairs) {
  const rows = (Array.isArray(pairs) ? pairs : []).filter((pair) => pair && pair.human && pair.llm);
  const total = rows.length;
  if (!total) return { total: 0, exact: null, usable: null, bad_recall: null, bad_precision: null, matrix: {}, by_verdict: {} };

  const usableOf = (verdict) => (verdict === "bad" ? "bad" : "usable");
  let exact = 0;
  let usable = 0;
  const matrix = {};
  const byVerdict = {};

  for (const row of rows) {
    if (row.human === row.llm) exact += 1;
    if (usableOf(row.human) === usableOf(row.llm)) usable += 1;
    const key = `${row.human}->${row.llm}`;
    matrix[key] = (matrix[key] || 0) + 1;
    const entry = byVerdict[row.human] || { total: 0, matched: 0 };
    entry.total += 1;
    if (row.human === row.llm) entry.matched += 1;
    byVerdict[row.human] = entry;
  }

  const humanBad = rows.filter((row) => row.human === "bad");
  const llmBad = rows.filter((row) => row.llm === "bad");
  const ratio = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);

  return {
    total,
    exact: ratio(exact, total),
    usable: ratio(usable, total),
    // 사람이 bad라 한 것 중 LLM도 bad라 한 비율
    bad_recall: ratio(humanBad.filter((row) => row.llm === "bad").length, humanBad.length),
    // LLM이 bad라 한 것 중 사람도 bad라 한 비율 — 낮으면 사람이 헛일을 많이 한다
    bad_precision: ratio(llmBad.filter((row) => row.human === "bad").length, llmBad.length),
    matrix,
    by_verdict: Object.fromEntries(
      Object.entries(byVerdict).map(([verdict, entry]) => [verdict, { ...entry, rate: ratio(entry.matched, entry.total) }]),
    ),
  };
}
