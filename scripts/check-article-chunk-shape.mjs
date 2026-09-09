// 기사 청크 구성 회귀. 네트워크·API 호출 없음.
//
// 2026-09-09: 청크마다 `[한국어 팩트 요약] 제목+요약`을 복사해 붙여, 긴 기사 하나가 검색 결과를
// 독점했다(기사 청크 627개 중 61.2%가 같은 기사의 다른 청크와 앞 160자가 같았다). 요약은 첫 조각에만
// 넣고 본문 조각에는 제목 한 줄만 붙인다.
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.OPENAI_API_KEY = "test-only";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const {
  ARTICLE_BODY_LABELS, ARTICLE_SUMMARY_LABEL, ARTICLE_TITLE_LABEL,
  buildArticleChunkTexts, splitArticleChunkText,
} = await import("../lib/vector-ingestion.js");

const TITLE = "닝더스다이(CATL), 브라질 저장 경매 겨냥 협력";
const SUMMARY = "- 닝더스다이(CATL), Moura와 협력.\n- EPE, 6,091건 입찰 접수.";
const BODY = ["첫 문단 본문입니다.", "둘째 문단 본문입니다.", "셋째 문단 본문입니다."];

// --- 1) 조립: 요약 한 조각 + 본문 조각들 -------------------------------------
const texts = buildArticleChunkTexts({ titleKo: TITLE, summaryKo: SUMMARY, bodyChunks: BODY, bodyLabel: ARTICLE_BODY_LABELS.original });
assert.equal(texts.length, BODY.length + 1, "요약 한 조각이 앞에 붙어 본문 조각 수보다 하나 많다");
assert.ok(texts[0].startsWith(ARTICLE_SUMMARY_LABEL), "첫 조각은 요약이다");
assert.ok(texts[0].includes(SUMMARY), "요약 전문이 첫 조각에 있다");
for (const text of texts.slice(1)) {
  assert.ok(text.startsWith(`${ARTICLE_TITLE_LABEL} ${TITLE}`), `본문 조각은 제목 한 줄로 시작한다: ${text.slice(0, 40)}`);
  assert.ok(!text.includes(SUMMARY), "본문 조각에 요약을 복사하지 않는다 — 이것이 이 변경의 목적이다");
  assert.ok(!text.includes(ARTICLE_SUMMARY_LABEL), "본문 조각에 요약 라벨이 남으면 안 된다");
}
// 앞 160자가 같은 조각이 없어야 한다. 예전에는 전부 같았다.
const heads = texts.map((text) => text.slice(0, 160));
assert.equal(new Set(heads).size, heads.length, "조각들의 앞머리가 서로 달라야 한다");

// 본문이 없으면 요약 한 조각. 요약이 너무 짧으면 아무것도 만들지 않는다(예전 규칙 유지).
assert.deepEqual(buildArticleChunkTexts({ titleKo: TITLE, summaryKo: SUMMARY, bodyChunks: [] }).length, 1);
assert.deepEqual(buildArticleChunkTexts({ titleKo: "짧", summaryKo: "", bodyChunks: [] }), [], "알맹이 없는 요약은 저장하지 않는다");
// 요약이 없고 본문만 있으면 본문 조각만 만든다.
assert.equal(buildArticleChunkTexts({ titleKo: "짧", summaryKo: "", bodyChunks: BODY }).length, BODY.length);

// --- 2) 복원: 옛 형식과 새 형식을 모두 읽는다 --------------------------------
// 마이그레이션이 두 번 돌아도 결과가 같아야 하므로 새 형식도 읽을 수 있어야 한다.
const fromNew = splitArticleChunkText(texts[1]);
assert.equal(fromNew.title, TITLE);
assert.equal(fromNew.summary, "", "새 형식의 본문 조각에는 요약이 없다");
assert.equal(fromNew.body, BODY[0]);
const fromNewSummary = splitArticleChunkText(texts[0]);
assert.equal(fromNewSummary.summary, SUMMARY, "요약 조각에서 요약을 되살린다");
assert.equal(fromNewSummary.body, "", "요약 조각에는 본문이 없다");

// 옛 형식: 요약이 모든 조각에 붙어 있던 것.
const legacy = `${ARTICLE_SUMMARY_LABEL}\n${TITLE}\n${SUMMARY}\n\n${ARTICLE_BODY_LABELS.original}\n${BODY[0]}`;
const fromLegacy = splitArticleChunkText(legacy);
assert.equal(fromLegacy.title, TITLE, "옛 형식에서 제목을 되살린다");
assert.equal(fromLegacy.summary, SUMMARY, "옛 형식에서 요약을 되살린다");
assert.equal(fromLegacy.body, BODY[0], "옛 형식에서 본문을 되살린다");
// 번역 본문 라벨도 같은 규칙.
const legacyTranslated = `${ARTICLE_SUMMARY_LABEL}\n${TITLE}\n${SUMMARY}\n\n${ARTICLE_BODY_LABELS.translated}\n${BODY[1]}`;
assert.equal(splitArticleChunkText(legacyTranslated).body, BODY[1]);
assert.equal(splitArticleChunkText(legacyTranslated).bodyLabel, ARTICLE_BODY_LABELS.translated);

// 옛 조각들을 되살려 다시 조립하면 새 형식이 나온다(마이그레이션이 하는 일).
const legacyRows = BODY.map((body) => `${ARTICLE_SUMMARY_LABEL}\n${TITLE}\n${SUMMARY}\n\n${ARTICLE_BODY_LABELS.original}\n${body}`);
const parsed = legacyRows.map(splitArticleChunkText);
const rebuilt = buildArticleChunkTexts({
  titleKo: parsed[0].title, summaryKo: parsed[0].summary,
  bodyChunks: parsed.map((item) => item.body), bodyLabel: ARTICLE_BODY_LABELS.original,
});
assert.deepEqual(rebuilt, texts, "옛 조각을 되살려 다시 조립하면 새 형식과 같아야 한다");

// --- 3) 파이프라인이 실제로 이 함수를 쓰는지 ---------------------------------
const source = fs.readFileSync(new URL("../lib/vector-ingestion.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
// 정의 한 번 + 호출 두 번(원문 보관 경로, 번역 경로).
assert.equal((source.match(/[^n] buildArticleChunkTexts\(\{|= buildArticleChunkTexts\(\{/g) || []).length, 2,
  "원문 보관 경로와 번역 경로가 모두 같은 조립 함수를 써야 한다");
assert.ok(source.includes("bodyLabel: ARTICLE_BODY_LABELS.translated"), "번역 경로는 한국어 본문 라벨을 쓴다");
assert.ok(source.includes("bodyLabel: ARTICLE_BODY_LABELS.original"), "원문 보관 경로는 원문 근거 라벨을 쓴다");
assert.ok(!source.includes("const header = `[한국어 팩트 요약]"), "조각마다 요약을 붙이던 옛 조립이 남으면 안 된다");
// 형식이 바뀌면 content_hash가 달라져 새 행이 된다. 옛 행을 지우지 않으면 같은 기사가 두 벌 남는다.
assert.equal((source.match(/knowledge_chunk\?article_id=eq\.\$\{encodeURIComponent\(article\.id\)\}&source_type=eq\.article_chunk`, \{ method: "DELETE"/g) || []).length, 2,
  "두 경로 모두 다시 넣기 전에 그 기사의 옛 조각을 비워야 한다");

const migration = fs.readFileSync(new URL("./restructure-article-chunks.mjs", import.meta.url), "utf8");
assert.ok(migration.includes("--apply"), "마이그레이션은 기본이 dry-run이어야 한다");
assert.ok(migration.indexOf("method: \"POST\"") < migration.indexOf("method: \"DELETE\""),
  "먼저 넣고 나중에 지워야 한다. 순서가 반대면 실패한 기사의 근거가 사라진다");

console.log("ok  article-chunk-shape");
