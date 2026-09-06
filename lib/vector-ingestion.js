import crypto from "node:crypto";
import { supabaseRest } from "../api/lib/supabase.js";

const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 180;
const MAX_CHUNKS = 24;

function splitAtBoundary(text, start) {
  const ceiling = Math.min(text.length, start + CHUNK_CHARS);
  if (ceiling === text.length) return ceiling;
  const boundary = Math.max(text.lastIndexOf("\n", ceiling), text.lastIndexOf("。", ceiling), text.lastIndexOf(". ", ceiling));
  return boundary > start + Math.floor(CHUNK_CHARS * 0.55) ? boundary + 1 : ceiling;
}

export function chunkArticleBody(body = "") {
  const text = String(body).replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < text.length && chunks.length < MAX_CHUNKS;) {
    const end = splitAtBoundary(text, start);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

async function createEmbeddings(inputs) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!apiKey) throw new Error("EMBEDDING_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: inputs, encoding_format: "float" })
  });
  if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
  const payload = await response.json();
  const embeddings = (payload.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
  if (embeddings.length !== inputs.length || embeddings.some((item) => !item?.length)) throw new Error("INVALID_EMBEDDING_RESPONSE");
  return { model, embeddings };
}

// 생성된 Daily 리포트를 벡터 검색 대상으로 만든다.
// 한 번 만든 결과를 다시 만들지 않고 재사용하고, 나중에 다른 서비스에서도 쓰기 위함이다.
// 사실(summary)과 해석(insight)은 검색 목적이 달라 청크를 나눈다.
export async function embedDailyReport({ reportDate, summaryKo, insightKo }) {
  const parts = [
    summaryKo ? { kind: "사실", text: summaryKo } : null,
    insightKo ? { kind: "해석", text: insightKo } : null,
  ].filter(Boolean);
  if (!parts.length) return { chunks: 0, status: "skipped" };
  const inputs = parts.map((part) => `[Daily 리포트 ${part.kind}] ${reportDate}\n${part.text}`);
  const { model, embeddings } = await createEmbeddings(inputs);
  const rows = parts.map((part, index) => ({
    company_id: null,
    source_type: "daily_report",
    source_url: `https://china-battery-lens.vercel.app/?report=${reportDate}`,
    source_name: `China Battery Lens Daily ${reportDate} · ${part.kind}`,
    published_at: reportDate,
    content_ko: inputs[index],
    chunk_index: index,
    chunk_total: parts.length,
    content_hash: crypto.createHash("sha256").update(`daily:${reportDate}:${part.kind}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows
  });
  return { chunks: rows.length, status: "embedded", model };
}

// 기업 시계열 이벤트를 벡터 검색 대상으로 만든다.
// 기사 본문 청크와 달리 이벤트는 이미 한국어 팩트로 압축돼 있으므로 한 건이 곧 한 청크다.
// 회사별 검색이 되도록 company_id를 채우고, 원문 발췌를 함께 넣어 근거 인용이 가능하게 한다.
export async function embedEvents(events = []) {
  const rows = events.filter((event) => event.title_ko && event.fact_ko);
  if (!rows.length) return { chunks: 0, status: "skipped" };
  const inputs = rows.map((event) => [
    `[회사] ${event.company_name_ko || event.company_id}`,
    `[시점] ${event.occurred_at}`,
    `[구분] ${event.trajectory_track === "technology" ? "기술" : event.trajectory_track === "both" ? "시장·기술" : "시장"}${event.layer_key ? ` / ${event.layer_key}` : ""}`,
    event.entity_names?.length ? `[발생 법인] ${event.entity_names.join(", ")}` : "",
    `[사실] ${event.title_ko}`,
    event.fact_ko,
    event.original_excerpt_ko ? `[원문 번역] ${event.original_excerpt_ko}` : "",
  ].filter(Boolean).join("\n"));
  const { model, embeddings } = await createEmbeddings(inputs);
  const chunks = rows.map((event, index) => ({
    company_id: event.company_id,
    article_id: event.article_id || null,
    event_id: event.id,
    source_type: "event_fact",
    source_url: event.source_url,
    source_name: event.source_name,
    published_at: event.occurred_at ? String(event.occurred_at).slice(0, 10) : null,
    original_excerpt: event.original_excerpt,
    content_ko: inputs[index],
    content_hash: crypto.createHash("sha256").update(`event:${event.id}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: chunks
  });
  return { chunks: chunks.length, status: "embedded", model };
}

// 본문 검증을 거치지 않은 수집 기사의 제목을 벡터 검색 대상으로 만든다.
//
// 하루에 수백 건이 수집되지만 본문을 읽는 것은 상위 몇십 건뿐이라, 나머지는 벡터 지식에서
// 통째로 빠져 있었다. 제목만이라도 넣어 "그런 소식이 있었는지"는 찾을 수 있게 한다.
// 본문 근거가 아니므로 source_type을 headline으로 따로 두고, 검색은 기본적으로 이를 제외한다.
// 원문 제목은 중국어라 한국어 질문과 매칭되지 않으므로 번역된 제목을 함께 넣는다.
export async function embedHeadlines(items = []) {
  const rows = items.filter((item) => item.id && item.titleKo);
  if (!rows.length) return { chunks: 0, status: "skipped" };
  const inputs = rows.map((item) => [
    `[미검증 헤드라인] ${item.sourceName || "출처 미상"} · ${item.publishedAt ? String(item.publishedAt).slice(0, 10) : "시점 미상"}`,
    item.companyName ? `[회사] ${item.companyName}` : "",
    `[제목] ${item.titleKo}`,
    item.keywordsKo?.length ? `[키워드] ${item.keywordsKo.join(", ")}` : "",
    `[원문 제목] ${item.titleOriginal || ""}`,
  ].filter(Boolean).join("\n"));
  const { model, embeddings } = await createEmbeddings(inputs);
  const chunks = rows.map((item, index) => ({
    company_id: item.companyId || null,
    article_id: item.id,
    source_type: "headline",
    source_url: item.sourceUrl,
    source_name: item.sourceName,
    published_at: item.publishedAt ? String(item.publishedAt).slice(0, 10) : null,
    original_excerpt: item.titleOriginal || null,
    content_ko: inputs[index],
    chunk_index: 0,
    chunk_total: 1,
    content_hash: crypto.createHash("sha256").update(`headline:${item.id}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: chunks
  });
  return { chunks: chunks.length, status: "embedded", model };
}

export async function embedVerifiedArticle({ article, companyId, bodyText, summaryKo, titleKo, sourceUrl, sourceName, publishedAt }) {
  const originalChunks = chunkArticleBody(bodyText);
  if (!originalChunks.length) return { chunks: 0, status: "skipped" };
  // Korean fact summary is deliberately repeated in every chunk. This keeps
  // Korean retrieval effective while preserving the complete Chinese/English
  // source body without paying to translate every paragraph.
  const header = `[한국어 팩트 요약]\n${titleKo || article.title_original}\n${summaryKo || ""}\n\n[원문 근거 청크]\n`;
  const inputs = originalChunks.map((chunk) => `${header}${chunk}`);
  const { model, embeddings } = await createEmbeddings(inputs);
  const total = originalChunks.length;
  const rows = originalChunks.map((chunk, index) => ({
    company_id: companyId,
    article_id: article.id,
    source_type: "article_chunk",
    source_url: sourceUrl,
    source_name: sourceName,
    published_at: publishedAt ? String(publishedAt).slice(0, 10) : null,
    content_ko: inputs[index],
    content_original: chunk,
    chunk_index: index,
    chunk_total: total,
    content_hash: crypto.createHash("sha256").update(`${article.id}:${index}:${chunk}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows
  });
  await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
    method: "PATCH", body: { embedding_status: "embedded", embedded_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  });
  return { chunks: total, status: "embedded", model };
}
