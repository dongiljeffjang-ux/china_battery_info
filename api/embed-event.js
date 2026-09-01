import crypto from "node:crypto";
import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

async function createEmbedding(content) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!apiKey) throw new Error("EMBEDDING_NOT_CONFIGURED");
  const upstream = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: content, encoding_format: "float" }),
  });
  if (!upstream.ok) throw new Error(`OPENAI_EMBEDDING_${upstream.status}`);
  const payload = await upstream.json();
  return { model, embedding: payload.data?.[0]?.embedding };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!authorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  const eventId = String(request.body?.eventId || "").trim();
  if (!eventId) return response.status(400).json({ status: "invalid_request", message: "eventId is required" });
  try {
    const rows = await supabaseRest(`event?select=id,company_id,article_id,occurred_at,title_ko,fact_ko,source_url,source_name,original_excerpt,article(verification_status)&id=eq.${encodeURIComponent(eventId)}&limit=1`);
    const event = rows[0];
    if (!event || event.article?.verification_status !== "approved") return response.status(409).json({ status: "not_approved" });
    const content = `${event.title_ko}\n${event.fact_ko}`;
    const { model, embedding } = await createEmbedding(content);
    if (!embedding?.length) throw new Error("EMPTY_EMBEDDING");
    const contentHash = crypto.createHash("sha256").update(`${event.id}:${content}`).digest("hex");
    await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: {
        company_id: event.company_id, article_id: event.article_id, event_id: event.id,
        source_type: "event_fact", source_url: event.source_url, source_name: event.source_name,
        published_at: event.occurred_at, original_excerpt: event.original_excerpt,
        content_ko: content, content_hash: contentHash, embedding, embedding_model: model,
      }
    });
    return response.status(200).json({ status: "ok", eventId, embeddingModel: model });
  } catch (error) {
    return response.status(502).json({ status: "embedding_failed", message: error.message });
  }
}
