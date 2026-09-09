// 기사 청크를 새 구성으로 다시 만든다. 요약은 첫 조각에만, 본문 조각에는 제목 한 줄만.
//
//   node --env-file=.env.local scripts/restructure-article-chunks.mjs            # 실측만(쓰기 없음)
//   node --env-file=.env.local scripts/restructure-article-chunks.mjs --apply    # 실제 교체
//   node --env-file=.env.local scripts/restructure-article-chunks.mjs --apply --limit 5
//
// 왜(2026-09-09 실측). 예전 규칙은 청크마다 `[한국어 팩트 요약] 제목+요약`을 통째로 복사해 붙였다.
// 긴 기사 하나가 21개 청크가 되면 21개 전부가 같은 수백 자로 시작해 검색기 양쪽에 무더기로 걸렸다.
// 기사 청크 627개 중 61.2%가 같은 기사의 다른 청크와 앞 160자가 같았고, "전고체 배터리 준비중인
// 회사들"에서는 근거 10건 중 6건이 같은 SMM 기사였다.
//
// 본문은 원문을 다시 받지 않는다. 저장된 content_ko에서 되살린다(splitArticleChunkText).
// 기사 원문(body_original)은 임베딩 뒤 지워지므로 재번역 경로가 없기 때문이다.
//
// 쓰기 방식: 기사 하나씩 새 행을 넣고 그 기사의 옛 행만 지운다. 넣기가 실패하면 지우지 않는다 —
// 순서를 반대로 하면 실패한 기사의 근거가 통째로 사라진다.
import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { buildArticleChunkTexts, splitArticleChunkText, ARTICLE_BODY_LABELS } from "../lib/vector-ingestion.js";
import crypto from "node:crypto";

const APPLY = process.argv.includes("--apply");
const limitIndex = process.argv.indexOf("--limit");
const ARTICLE_LIMIT = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;
const PAGE = 500;
const SELECT = "id,article_id,company_id,source_url,source_name,published_at,content_ko,content_original,chunk_index,chunk_total";

if (!hasDatabaseConfig()) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없다. --env-file=.env.local로 실행한다.");
  process.exit(1);
}

async function fetchAllChunks() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabaseRest(`knowledge_chunk?select=${SELECT}&source_type=eq.article_chunk&order=article_id.asc,chunk_index.asc&limit=${PAGE}&offset=${offset}`);
    rows.push(...(page || []));
    if (!page || page.length < PAGE) return rows;
  }
}

async function embed(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
  const payload = await response.json();
  return { model, embeddings: (payload.data || []).map((item) => item.embedding) };
}

const chunks = await fetchAllChunks();
const byArticle = new Map();
for (const row of chunks) {
  if (!row.article_id) continue;
  if (!byArticle.has(row.article_id)) byArticle.set(row.article_id, []);
  byArticle.get(row.article_id).push(row);
}

console.log(`기사 ${byArticle.size}건 · 청크 ${chunks.length}개`);

const plans = [];
let alreadyNew = 0;
for (const [articleId, rows] of byArticle) {
  rows.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
  const parsed = rows.map((row) => ({ row, ...splitArticleChunkText(row.content_ko) }));
  // 이미 새 형식이면(요약 조각 하나 + 제목만 붙은 본문 조각들) 건너뛴다. 두 번 돌려도 안전해야 한다.
  if (parsed.every((item) => !item.summary || !item.body)) { alreadyNew += 1; continue; }
  const withSummary = parsed.find((item) => item.summary);
  const title = withSummary?.title || parsed[0]?.title || "";
  const summary = withSummary?.summary || "";
  const bodyLabel = parsed.find((item) => item.bodyLabel)?.bodyLabel || ARTICLE_BODY_LABELS.original;
  const bodyChunks = parsed.filter((item) => item.body).map((item) => item.body);
  const texts = buildArticleChunkTexts({ titleKo: title, summaryKo: summary, bodyChunks, bodyLabel });
  if (!texts.length) continue;
  const sample = rows[0];
  const summaryFirst = texts.length === bodyChunks.length + 1;
  plans.push({
    articleId, texts, before: rows.length, after: texts.length, summaryFirst,
    originals: parsed.filter((item) => item.body).map((item) => item.row.content_original || null),
    meta: { company_id: sample.company_id, source_url: sample.source_url, source_name: sample.source_name, published_at: sample.published_at },
  });
}

const beforeChars = plans.reduce((sum, plan) => sum + plan.before, 0);
const afterChars = plans.reduce((sum, plan) => sum + plan.after, 0);
console.log(`바꿀 기사 ${plans.length}건 (이미 새 형식 ${alreadyNew}건)`);
console.log(`  청크 ${beforeChars} → ${afterChars}`);
console.log(`  임베딩 호출 대상 ${afterChars}개`);

if (!APPLY) {
  const sample = plans.find((plan) => plan.after >= 3);
  if (sample) {
    console.log(`\n표본 (기사 ${sample.articleId}):`);
    sample.texts.slice(0, 3).forEach((text, index) => {
      console.log(`  [${index}] ${text.replace(/\n/g, " | ").slice(0, 130)}`);
    });
  }
  console.log("\ndry-run. DB에 쓰지 않았고 임베딩도 부르지 않았다. 실제로 바꾸려면 --apply.");
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const plan of plans.slice(0, ARTICLE_LIMIT)) {
  try {
    const { model, embeddings } = await embed(plan.texts);
    if (embeddings.length !== plan.texts.length) throw new Error("EMBEDDING_COUNT_MISMATCH");
    const rows = plan.texts.map((content, index) => ({
      company_id: plan.meta.company_id,
      article_id: plan.articleId,
      source_type: "article_chunk",
      source_url: plan.meta.source_url,
      source_name: plan.meta.source_name,
      published_at: plan.meta.published_at,
      content_ko: content,
      content_original: plan.summaryFirst && index === 0 ? null : plan.originals[plan.summaryFirst ? index - 1 : index] || null,
      chunk_index: index,
      chunk_total: plan.texts.length,
      content_hash: crypto.createHash("sha256").update(`${plan.articleId}:${index}:${content}`).digest("hex"),
      embedding: embeddings[index],
      embedding_model: model,
    }));
    // 먼저 넣고 나중에 지운다. 넣기가 실패하면 옛 근거가 그대로 남는다.
    await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows,
    });
    const keep = new Set(rows.map((row) => row.content_hash));
    const existing = await supabaseRest(`knowledge_chunk?select=id,content_hash&source_type=eq.article_chunk&article_id=eq.${encodeURIComponent(plan.articleId)}`);
    const stale = (existing || []).filter((row) => !keep.has(row.content_hash)).map((row) => row.id);
    for (const id of stale) {
      await supabaseRest(`knowledge_chunk?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
    }
    done += 1;
    console.log(`  ok  ${plan.articleId} ${plan.before} → ${rows.length} (옛 조각 ${stale.length}건 정리)`);
  } catch (error) {
    failed += 1;
    console.error(`  실패 ${plan.articleId}: ${String(error.message || error).slice(0, 160)}`);
  }
}
console.log(`\n완료 ${done}건 · 실패 ${failed}건`);
process.exit(failed ? 1 : 0);
