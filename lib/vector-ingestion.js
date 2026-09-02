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
