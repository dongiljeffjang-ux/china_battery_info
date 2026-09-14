import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 벡터 지식(RAG) 사람 평가 회귀 검사. 네트워크를 쓰지 않는다. API 과금이 없다.
//
// 지키려는 성질.
//   1. 화면이 보낸 값을 그대로 믿지 않는다. 판정·사유·순위가 목록 밖이면 저장 행을 만들지 않는다.
//   2. 같은 질문은 표기가 달라도 한 묶음으로 세고, 검색 조건이 다르면 다른 묶음이 된다.
//   3. 평가하지 않은 것은 분모에 들어가지 않는다. 안 본 것이 '무관'과 같은 값이 되면 안 된다.
//   4. lib의 판정 목록과 SQL 제약이 갈리지 않는다.

const {
  ISSUE_TAGS, VERDICTS, buildEvaluationRow, buildRetrievalSessions, questionKey, summarizeEvaluations,
} = await import("../lib/rag-evaluation.js");

const CHUNK = "11111111-2222-3333-4444-555555555555";

// --- 1) 입력 검증 -----------------------------------------------------------

const fails = (input, reason) => {
  assert.throws(() => buildEvaluationRow(input), (error) => error.reason === reason,
    `${reason}로 거절해야 한다: ${JSON.stringify(input)}`);
};

fails({ subject_type: "guess", chunk_id: CHUNK, verdict: "good" }, "invalid_subject_type");
fails({ subject_type: "chunk", chunk_id: CHUNK, verdict: "excellent" }, "invalid_verdict");
fails({ subject_type: "chunk", chunk_id: "not-a-uuid", verdict: "good" }, "invalid_chunk_id");
// 검색 평가는 "어떤 질문에 몇 번째"라는 맥락 없이는 정밀도를 셀 수 없다.
fails({ subject_type: "retrieval", chunk_id: CHUNK, verdict: "good", result_rank: 1 }, "question_required");
fails({ subject_type: "retrieval", chunk_id: CHUNK, verdict: "good", question: "LFP 증설" }, "invalid_result_rank");
fails({ subject_type: "retrieval", chunk_id: CHUNK, verdict: "good", question: "LFP 증설", result_rank: 0 }, "invalid_result_rank");
fails({ subject_type: "retrieval", chunk_id: CHUNK, verdict: "good", question: "LFP 증설", result_rank: 2.5 }, "invalid_result_rank");

const chunkRow = buildEvaluationRow({
  subject_type: "chunk", chunk_id: CHUNK, verdict: "bad",
  chunk_source_type: "article_chunk", company_id: "catl",
  // 검색 평가용 사유를 청크 평가에 섞어 보낸다. 목록 밖이므로 조용히 버려야 한다.
  issue_tags: ["wrong_company", "off_topic", "존재하지않는사유", "wrong_company"],
  note: "  본문이 다른 회사 이야기다  ",
});
assert.deepEqual(chunkRow.issue_tags, ["wrong_company"], "다른 대상의 사유와 중복은 걸러야 한다");
assert.equal(chunkRow.note, "본문이 다른 회사 이야기다", "메모는 앞뒤 공백을 턴다");
assert.equal(chunkRow.question_key, null, "청크 평가에는 질문 맥락을 넣지 않는다");
assert.equal(chunkRow.result_rank, null, "청크 평가에는 순위를 넣지 않는다");
assert.equal(chunkRow.evaluator, "admin", "평가자 기본값");

const retrievalRow = buildEvaluationRow({
  subject_type: "retrieval", chunk_id: CHUNK, verdict: "partial",
  question: "CATL 나트륨 배터리 양산 시점", result_rank: 3,
  retrieved_by: ["vector", "lexical", "telepathy"], similarity: 0.812,
  filter_company_id: "catl", include_unverified: true,
  issue_tags: ["stale", "no_fact"],
});
assert.deepEqual(retrievalRow.retrieved_by, ["vector", "lexical"], "모르는 검색기 이름은 버린다");
assert.deepEqual(retrievalRow.issue_tags, ["stale"], "청크용 사유는 검색 평가에서 버린다");
assert.ok(retrievalRow.question_key, "검색 평가에는 질문 키가 있어야 한다");

// 메모가 아무리 길어도 저장 길이를 넘기지 않는다.
const longNote = buildEvaluationRow({ subject_type: "chunk", chunk_id: CHUNK, verdict: "good", note: "가".repeat(900) });
assert.equal(longNote.note.length, 500, "메모는 500자에서 자른다");

// --- 2) 질문 키 -------------------------------------------------------------

const base = { question: "CATL 나트륨 배터리 양산 시점", companyId: "catl", includeUnverified: false };
assert.equal(
  questionKey(base),
  questionKey({ ...base, question: "  catl   나트륨 배터리 양산   시점 " }),
  "공백·대소문자 차이는 같은 질문으로 묶는다",
);
assert.notEqual(questionKey(base), questionKey({ ...base, companyId: null }), "회사 필터가 다르면 다른 검색이다");
assert.notEqual(questionKey(base), questionKey({ ...base, includeUnverified: true }), "미검증 포함 여부가 다르면 다른 검색이다");
assert.notEqual(questionKey(base), questionKey({ ...base, question: "CATL LFP 양산 시점" }), "다른 질문은 다른 키다");

// --- 3) 집계 ---------------------------------------------------------------

const rows = [
  { subject_type: "chunk", chunk_id: "c1", chunk_source_type: "article_chunk", company_id: "catl", verdict: "good", issue_tags: [] },
  { subject_type: "chunk", chunk_id: "c2", chunk_source_type: "article_chunk", company_id: "catl", verdict: "bad", issue_tags: ["wrong_company", "truncated"] },
  { subject_type: "chunk", chunk_id: "c3", chunk_source_type: "event_fact", company_id: "byd", verdict: "partial", issue_tags: ["wrong_company"] },
];
const summary = summarizeEvaluations(rows, {
  chunkTotals: [{ source_type: "article_chunk", count: 600 }, { source_type: "event_fact", count: 400 }],
});
assert.equal(summary.chunk.evaluated, 3);
assert.equal(summary.chunk.corpus, 1000);
assert.equal(summary.chunk.coverage, 0.003, "진행률은 코퍼스 전체를 분모로 쓴다");
// 1 + 0 + 0.5 = 1.5, 3건 → 0.5
assert.equal(summary.chunk.score, 0.5, "쓸 만함 1점·애매 0.5점·못 씀 0점의 평균");
const articleChunk = summary.chunk.by_source_type.find((entry) => entry.key === "article_chunk");
assert.equal(articleChunk.total, 2);
assert.equal(articleChunk.corpus, 600, "종류별 코퍼스 건수를 붙여 진행률을 볼 수 있어야 한다");
assert.equal(summary.chunk.issue_tags[0].id, "wrong_company", "가장 잦은 사유가 앞에 온다");
assert.equal(summary.chunk.issue_tags[0].count, 2);
assert.ok(!summary.chunk.issue_tags.some((tag) => tag.count === 0), "한 번도 안 쓴 사유는 표에 넣지 않는다");
assert.equal(summary.retrieval.evaluated, 0, "청크 평가가 검색 집계에 섞이면 안 된다");

// 평가가 하나도 없을 때 0으로 나누지 않는다.
const empty = summarizeEvaluations([], { chunkTotals: [] });
assert.equal(empty.chunk.score, null);
assert.equal(empty.chunk.coverage, null);
assert.equal(empty.retrieval.score, null);

// --- 4) 질문별 검색 세션 -----------------------------------------------------

const key = questionKey({ question: "LFP 증설", companyId: null, includeUnverified: false });
const otherKey = questionKey({ question: "실리콘 음극", companyId: null, includeUnverified: false });
const retrievalRows = [
  { subject_type: "retrieval", question_key: key, question: "LFP 증설", chunk_id: "c1", result_rank: 1, verdict: "good", retrieved_by: ["vector", "lexical"], issue_tags: [], updated_at: "2026-09-08T01:00:00Z" },
  { subject_type: "retrieval", question_key: key, question: "LFP 증설", chunk_id: "c2", result_rank: 4, verdict: "bad", retrieved_by: ["lexical"], issue_tags: ["off_topic"], updated_at: "2026-09-08T02:00:00Z" },
  { subject_type: "retrieval", question_key: key, question: "LFP 증설", chunk_id: "c3", result_rank: 9, verdict: "bad", retrieved_by: ["vector"], issue_tags: [], updated_at: "2026-09-08T03:00:00Z" },
  { subject_type: "retrieval", question_key: otherKey, question: "실리콘 음극", chunk_id: "c4", result_rank: 1, verdict: "good", retrieved_by: ["vector"], issue_tags: [], updated_at: "2026-09-07T01:00:00Z" },
  // 청크 평가는 검색 세션에 들어가면 안 된다.
  { subject_type: "chunk", chunk_id: "c5", verdict: "good", issue_tags: [] },
];
const sessions = buildRetrievalSessions(retrievalRows);
assert.equal(sessions.length, 2, "질문 두 개가 두 세션이 된다");
const lfp = sessions.find((session) => session.question_key === key);
assert.equal(lfp.evaluated, 3);
assert.equal(lfp.precision, Math.round((1 / 3) * 1000) / 1000, "정밀도는 평가한 근거만 분모로 쓴다");
// 1위(관련)와 4위(무관)만 상위 5건이다. 9위는 빠진다.
assert.equal(lfp.precision_at_5, 0.5, "상위 5건 정밀도는 6위 이하를 포함하지 않아야 한다");
assert.equal(lfp.top_rank_bad, 4, "가장 앞선 무관 근거의 순위");
assert.equal(lfp.both, 1);
assert.equal(lfp.vector_only, 1);
assert.equal(lfp.lexical_only, 1);
assert.deepEqual(lfp.results.map((result) => result.rank), [1, 4, 9], "근거는 순위 순으로 정렬한다");
assert.equal(lfp.last_evaluated_at, "2026-09-08T03:00:00Z");
assert.equal(sessions[0].question_key, key, "최근 평가한 질문이 앞에 온다");

const retrievalSummary = summarizeEvaluations(retrievalRows, { chunkTotals: [] });
assert.equal(retrievalSummary.retrieval.questions, 2);
assert.equal(retrievalSummary.retrieval.evaluated, 4);
const both = retrievalSummary.retrieval.by_retriever.find((entry) => entry.key === "의미+단어");
assert.equal(both.good, 1, "양쪽에 다 걸린 근거의 성적을 따로 세야 가중치를 조정할 수 있다");
const lexicalOnly = retrievalSummary.retrieval.by_retriever.find((entry) => entry.key === "단어 검색");
assert.equal(lexicalOnly.bad, 1);
const topRanks = retrievalSummary.retrieval.by_rank.find((entry) => entry.key === "1–3위");
assert.equal(topRanks.total, 2, "1–3위 구간에 두 건");

// --- 5) lib와 SQL 제약이 갈리지 않는다 ----------------------------------------

const sql = readFileSync(new URL("../supabase/rag-evaluation.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
for (const verdict of VERDICTS) {
  assert.ok(sql.includes(`'${verdict.id}'`), `SQL의 verdict 제약에 ${verdict.id}가 있어야 한다`);
}
assert.ok(sql.includes("subject_type in ('chunk', 'retrieval')"), "SQL의 대상 종류 제약이 lib와 같아야 한다");
assert.ok(sql.includes("rag_evaluation_chunk_uniq"), "같은 청크 재평가는 덮어쓰도록 유니크 인덱스가 있어야 한다");
assert.ok(sql.includes("rag_evaluation_retrieval_uniq"), "같은 질문·근거 재평가도 덮어써야 한다");
assert.ok(sql.includes("revoke all on public.rag_evaluation from anon, authenticated"), "브라우저 키로는 못 읽게 막는다");

// 화면이 쓰는 사유 목록은 두 대상이 겹치지 않게 나뉘어 있어야 한다.
assert.ok(ISSUE_TAGS.chunk.length && ISSUE_TAGS.retrieval.length);
for (const list of Object.values(ISSUE_TAGS)) {
  assert.equal(new Set(list.map((tag) => tag.id)).size, list.length, "사유 id는 목록 안에서 유일해야 한다");
}

// --- 6) API 쓰기는 평가와 추적 대상 설정으로 제한한다 --------------------------

// CRLF로 체크아웃돼도 글자 대조가 깨지지 않게 줄바꿈을 맞춘다(2026-09-09).
const adminSource = readFileSync(new URL("../api/admin.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.ok(adminSource.includes('"benchmark-case-save": benchmarkCaseSave'),
  "RAGAS 평가세트 저장 경로가 명시적으로 열려 있어야 한다");
assert.ok(adminSource.includes('supabaseRest("rag_eval_case?select=*"'),
  "평가세트 쓰기는 평가 테이블에만 저장해야 한다");
assert.ok(adminSource.includes('COMPANIES.some((company) => company.id === companyId)'),
  "추적 대상 설정은 검증된 마스터 회사만 받아야 한다");
assert.ok(adminSource.includes('if (request.method !== "GET") return response.status(405)'),
  "POST 외의 메서드는 계속 막아야 한다");
assert.ok(adminSource.includes("rag_evaluation?id=eq."), "삭제는 평가 행 하나만 지운다");
assert.ok(!/knowledge_chunk\?[^`\n]*`, \{ method: "DELETE"/.test(adminSource), "청크를 지우는 경로가 생기면 안 된다");

// --- 7) 스키마 미적용 판정은 실제 PostgREST 신호만 본다 -------------------------
//
// 2026-09-09: 이 판정이 message.includes("rag_evaluation")로 넓게 잡던 시절, 존재하는
// chunk_id(REPT BATTERO article_chunk)에 대한 판정 저장이 다른 제약 위반으로 실패했는데도
// "supabase/rag-evaluation.sql을 아직 실행하지 않았습니다"로 잘못 안내됐다. 이 테이블의 제약
// 이름이 전부 "rag_evaluation_..."로 시작해 FK·체크·유니크 위반 메시지가 전부 그 substring을
// 포함하기 때문이다. 실제 원인이 화면에 안 뜨면 사람이 잘못된 곳(SQL 미실행)을 고치려 든다.
// 주석에는 예전 코드를 그대로 인용해 두었으니, 실행문(return 줄)만 뽑아서 검사한다.
const isSchemaMissingReturn = adminSource.match(/function isSchemaMissing\(error\) \{[\s\S]*?\n\s*return ([^\n]+);\n\}/)?.[1] || "";
assert.ok(isSchemaMissingReturn, "isSchemaMissing 함수의 return 문을 찾아야 한다");
assert.ok(!isSchemaMissingReturn.includes('"rag_evaluation"'),
  "테이블 이름 전체를 부분 문자열로 보면 이 테이블의 모든 제약 위반이 '스키마 없음'으로 오판된다");
assert.ok(!isSchemaMissingReturn.includes("404"),
  "무관한 404도 '스키마 없음'으로 잡으면 안 된다 — PGRST205만 그 신호다");
assert.ok(isSchemaMissingReturn.includes('"PGRST205"'),
  "PostgREST가 실제로 테이블을 못 찾을 때 내는 코드만 봐야 한다");

console.log("ok  rag-evaluation");

// --- 5) 배치 평가는 활성 문항을 전부 돌리고 abstention 문항을 분모에서 뺀다 ------------------
//
// 2026-09-10: 54문항에서 예전 상한 50에 걸려 4문항이 조용히 빠졌고, 정답 청크가 없는 답 없음 문항 5개가
// hit 0으로 잡혀 Hit@10이 0.89가 아니라 0.80으로 보였다. 둘 다 "검색이 나빠졌다"로 오독될 수 있는 숫자다.
const benchmarkSource = adminSource.slice(adminSource.indexOf("async function benchmarkRun()"));
assert.ok(!/limit=50\b/.test(benchmarkSource), "배치 평가 문항 상한이 50이면 세트가 커질 때 조용히 잘린다");
assert.match(benchmarkSource, /BENCHMARK_CASE_LIMIT/, "문항 상한은 이름 붙은 상수로 둔다");
assert.match(benchmarkSource, /if \(!expected\.size\) \{[\s\S]*?abstention \+= 1;[\s\S]*?continue;/, "정답 청크가 없는 문항은 점수 분모에 넣지 않고 abstention으로 센다");
assert.match(benchmarkSource, /abstention_cases: abstention/, "run 지표에 abstention 문항 수를 따로 남긴다");
assert.match(benchmarkSource, /commit/, "run에 커밋 SHA를 남겨야 같은 세트의 다른 코드를 구분한다");

console.log("ok  rag-evaluation (benchmark run)");
