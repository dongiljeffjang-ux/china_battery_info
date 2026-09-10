import assert from "node:assert/strict";

// LLM 자동 판정 회귀 검사. 네트워크를 쓰지 않는다. API 과금이 없다.
//
// 지키려는 성질.
//   1. 자동 판정은 사람 판정과 같은 판정값·사유 태그 목록을 쓴다. 두 목록이 갈리면 집계가 섞인다.
//   2. 프롬프트에 사람 판정이 새지 않는다. 새면 일치율이 측정이 아니라 따라쓰기가 된다.
//   3. 일치율은 판정이 있는 건만 분모에 넣는다. 실패한 호출이 '일치'로 세어지면 안 된다.
//   4. bad 재현율과 bad 정밀도를 뒤집어 세지 않는다. 선별기로 쓸지 판단하는 값이라 방향이 중요하다.

const { ISSUE_TAGS, VERDICTS } = await import("../lib/rag-evaluation.js");
const {
  buildChunkJudgePrompt, buildRetrievalJudgePrompt, judgeAgreement,
  CHUNK_JUDGE_SCHEMA, RETRIEVAL_JUDGE_SCHEMA,
} = await import("../lib/rag-llm-judge.js");

// --- 1) 사람 판정과 같은 목록을 쓴다 ----------------------------------------

const verdictIds = VERDICTS.map((verdict) => verdict.id).sort();
assert.deepEqual([...CHUNK_JUDGE_SCHEMA.properties.verdict.enum].sort(), verdictIds,
  "청크 판정 스키마의 판정값이 사람 판정 목록과 같아야 한다");
assert.deepEqual([...RETRIEVAL_JUDGE_SCHEMA.properties.verdict.enum].sort(), verdictIds,
  "검색 판정 스키마의 판정값이 사람 판정 목록과 같아야 한다");
assert.deepEqual(
  [...CHUNK_JUDGE_SCHEMA.properties.issue_tags.items.enum].sort(),
  ISSUE_TAGS.chunk.map((tag) => tag.id).sort(),
  "청크 사유 태그가 사람 판정 목록과 같아야 한다");
assert.deepEqual(
  [...RETRIEVAL_JUDGE_SCHEMA.properties.issue_tags.items.enum].sort(),
  ISSUE_TAGS.retrieval.map((tag) => tag.id).sort(),
  "검색 사유 태그가 사람 판정 목록과 같아야 한다");

// 스키마가 strict json_schema로 나가므로 additionalProperties가 열려 있으면 호출이 거절된다.
for (const schema of [CHUNK_JUDGE_SCHEMA, RETRIEVAL_JUDGE_SCHEMA]) {
  assert.equal(schema.additionalProperties, false, "strict 스키마는 추가 속성을 막아야 한다");
  assert.deepEqual(schema.required, ["verdict", "issue_tags", "reason_ko"],
    "판정·태그·사유가 모두 필수여야 사람이 뒤집을지 판단할 수 있다");
}

// --- 2) 사람 판정이 프롬프트로 새지 않는다 ----------------------------------

const chunk = {
  id: "11111111-2222-3333-4444-555555555555",
  source_type: "article_chunk",
  company_id: "catl",
  source_name: "차이신",
  published_at: "2026-09-01T00:00:00Z",
  content_ko: "CATL은 나트륨이온 배터리를 2026년 4분기부터 양산한다고 밝혔다.",
  // 판정자에게 보이면 안 되는 값을 일부러 섞어 둔다.
  verdict: "bad",
  human_verdict: "bad",
  issue_tags: ["off_topic"],
};

const chunkPrompt = buildChunkJudgePrompt(chunk);
const retrievalPrompt = buildRetrievalJudgePrompt({
  question: "CATL 나트륨배터리 양산 시점은?", chunk, rank: 3,
});

for (const [label, prompt] of [["청크", chunkPrompt], ["검색", retrievalPrompt]]) {
  const sent = `${prompt.instructions}\n${prompt.input}`;
  // "bad"는 판정 기준 설명에 정당하게 등장하므로, 사람 판정을 실어 나르는 필드 이름으로 검사한다.
  assert.ok(!sent.includes("human_verdict"), `${label} 프롬프트에 사람 판정 필드가 들어가면 안 된다`);
  assert.ok(!sent.includes("off_topic\"") && !sent.includes("['off_topic']"),
    `${label} 프롬프트에 사람이 단 사유 태그가 들어가면 안 된다`);
  assert.ok(sent.includes(chunk.content_ko), `${label} 프롬프트에 판정 대상 본문은 들어가야 한다`);
}

// 검색 판정은 질문과 순위라는 맥락이 있어야 성립한다.
assert.ok(retrievalPrompt.input.includes("CATL 나트륨배터리 양산 시점은?"), "검색 판정에 질문이 들어가야 한다");
assert.ok(retrievalPrompt.input.includes("3위"), "검색 판정에 순위가 들어가야 한다");
// 청크 판정은 질문이 없다. 질문을 끼워 넣으면 두 탭이 같은 실패를 보게 된다.
assert.ok(!chunkPrompt.input.includes("질문"), "청크 판정에 질문 맥락이 들어가면 안 된다");

// 본문이 길어도 잘라서 보낸다. 상한을 넘겨 보내면 호출이 통째로 실패한다.
const long = buildChunkJudgePrompt({ ...chunk, content_ko: "가".repeat(9000) });
assert.ok(long.input.length < 5000, "긴 청크는 잘라서 보내야 한다");

// --- 3) 일치율 계산 ---------------------------------------------------------

const empty = judgeAgreement([]);
assert.equal(empty.total, 0);
assert.equal(empty.exact, null, "판정이 없으면 일치율은 0이 아니라 null이다");

// 실패한 호출(llm이 null)은 분모에서 빠져야 한다.
const withFailures = judgeAgreement([
  { human: "good", llm: "good" },
  { human: "bad", llm: null },
  { human: "bad", llm: undefined },
]);
assert.equal(withFailures.total, 1, "판정이 없는 건은 분모에 넣지 않는다");
assert.equal(withFailures.exact, 1);

const sample = judgeAgreement([
  { human: "good", llm: "good" },       // 정확 일치
  { human: "good", llm: "partial" },    // 어긋나지만 둘 다 '쓸 수 있음'
  { human: "bad", llm: "bad" },         // 정확 일치
  { human: "bad", llm: "good" },        // LLM이 놓친 bad
  { human: "partial", llm: "bad" },     // LLM이 과하게 잡은 bad
]);
assert.equal(sample.total, 5);
assert.equal(sample.exact, 0.4, "5건 중 2건 정확 일치");
assert.equal(sample.usable, 0.6, "good/partial을 한 덩어리로 보면 3건 일치");
// 사람 bad 2건 중 LLM이 1건만 bad → 0.5
assert.equal(sample.bad_recall, 0.5, "사람이 bad라 한 것을 LLM이 잡은 비율");
// LLM bad 2건 중 사람도 bad인 것 1건 → 0.5
assert.equal(sample.bad_precision, 0.5, "LLM이 bad라 한 것 중 사람도 bad인 비율");

// 방향이 뒤집히지 않는지 비대칭 표본으로 다시 본다.
const skewed = judgeAgreement([
  { human: "bad", llm: "bad" },
  { human: "bad", llm: "bad" },
  { human: "good", llm: "bad" },
]);
assert.equal(skewed.bad_recall, 1, "사람 bad 2건을 모두 잡았으므로 재현율은 1");
// 비율은 소수 셋째 자리에서 반올림해 돌려준다. 화면과 로그에 그대로 실리는 값이라 자릿수를 고정한다.
assert.equal(skewed.bad_precision, 0.667, "LLM bad 3건 중 2건만 사람도 bad");
assert.equal(skewed.matrix["good->bad"], 1, "혼동 행렬은 사람->LLM 방향이다");
assert.equal(skewed.by_verdict.bad.rate, 1);
assert.equal(skewed.by_verdict.good.rate, 0);

console.log("ok  rag-llm-judge");
