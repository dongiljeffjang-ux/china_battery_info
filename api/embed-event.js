import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { requireAccess } from "./lib/access.js";
import { embedEvents } from "../lib/vector-ingestion.js";

// 한 번에 임베딩할 이벤트 수. 60초 함수 안에서 조회·임베딩·적재가 끝나야 한다.
const BATCH_LIMIT = 60;

const EVENT_SELECT = "id,company_id,article_id,occurred_at,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,company(name_ko)";

function isCronRequest(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function flatten(event) {
  return { ...event, company_name_ko: event.company?.name_ko || null };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isCronRequest(request) && !requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });

  const eventId = String(request.query?.eventId || request.body?.eventId || "").trim();
  const limit = Math.min(Number(request.query?.limit || request.body?.limit || BATCH_LIMIT) || BATCH_LIMIT, BATCH_LIMIT);
  try {
    let events;
    if (eventId) {
      events = (await supabaseRest(`event?select=${EVENT_SELECT}&id=eq.${encodeURIComponent(eventId)}&limit=1`)).map(flatten);
      if (!events.length) return response.status(404).json({ status: "event_not_found", eventId });
    } else {
      // 아직 벡터에 없는 이벤트만 고른다. knowledge_chunk.event_id가 채워진 것은 건너뛴다.
      const embedded = await supabaseRest("knowledge_chunk?select=event_id&event_id=not.is.null");
      const done = new Set(embedded.map((row) => row.event_id));
      const all = (await supabaseRest(`event?select=${EVENT_SELECT}&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=500`)).map(flatten);
      events = all.filter((event) => !done.has(event.id)).slice(0, limit);
      if (!events.length) return response.status(200).json({ status: "ok", embedded: 0, remaining: 0, message: "임베딩할 이벤트가 없습니다." });
    }

    const result = await embedEvents(events);
    const embedded = await supabaseRest("knowledge_chunk?select=event_id&event_id=not.is.null");
    const total = await supabaseRest("event?select=id&timeline_eligibility=neq.exclude");
    const remaining = Math.max(total.length - new Set(embedded.map((row) => row.event_id)).size, 0);
    console.info("[EVENT_EMBEDDING]", JSON.stringify({ requested: events.length, embedded: result.chunks, remaining }));
    return response.status(200).json({ status: "ok", embedded: result.chunks, remaining, model: result.model || null });
  } catch (error) {
    console.error("[EVENT_EMBEDDING_FAILED]", JSON.stringify({ message: error.message }));
    return response.status(502).json({ status: "embedding_failed", message: error.message });
  }
}
