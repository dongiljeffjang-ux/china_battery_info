import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_BODY_CHARS = 30000;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function analyzeArticle(article, bodyText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) throw new Error("LLM_NOT_CONFIGURED");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["summary_ko", "event_title_ko", "event_fact_ko", "original_excerpt", "original_excerpt_ko", "occurred_at", "trajectory_track", "layer_key", "region_scope", "timeline_eligibility", "confidence_note"],
    properties: {
      summary_ko: { type: "string" },
      event_title_ko: { type: "string" },
      event_fact_ko: { type: "string" },
      original_excerpt: { type: "string" },
      original_excerpt_ko: { type: "string" },
      occurred_at: { type: ["string", "null"] },
      trajectory_track: { type: "string", enum: ["market", "technology", "both"] },
      layer_key: { type: ["string", "null"] },
      region_scope: { type: ["string", "null"] },
      timeline_eligibility: { type: "string", enum: ["core", "reference", "exclude"] },
      confidence_note: { type: "string" }
    }
  };
  const input = `원문 제목: ${article.title_original}\n발행일: ${article.published_at || "미상"}\n매체: ${article.source_name}\n본문:\n${bodyText}`;
  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "중국 배터리 산업 기사에서 출처에 명시된 사실만 한국어로 구조화한다. 전망·인과 추정·성공 가능성을 만들지 않는다. 단일 제3자 언론 기사만으로는 timeline_eligibility를 core로 두지 않는다. original_excerpt에는 핵심 근거 원문을 300자 이내로만 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다.",
      input,
      text: { format: { type: "json_schema", name: "battery_article_event", strict: true, schema } }
    })
  });
  if (!upstream.ok) throw new Error(`OPENAI_${upstream.status}`);
  const payload = await upstream.json();
  return JSON.parse(payload.output_text);
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });

  const articleId = String(request.body?.articleId || "").trim();
  const companyId = String(request.body?.companyId || "").trim();
  if (!articleId || !companyId) return response.status(400).json({ status: "invalid_request", message: "articleId and companyId are required." });

  try {
    const articles = await supabaseRest(`article?select=id,canonical_url,title_original,source_name,published_at,source_tier&id=eq.${encodeURIComponent(articleId)}&verification_status=eq.pending&limit=1`);
    const article = articles[0];
    if (!article) return response.status(404).json({ status: "not_pending" });
    const sourceResponse = await fetch(article.canonical_url, { headers: { "User-Agent": "ChinaBatteryLens/0.1 (internal research)" } });
    const contentType = sourceResponse.headers.get("content-type") || "";
    if (!sourceResponse.ok || !contentType.includes("text/html")) return response.status(422).json({ status: "body_unavailable", contentType });
    const bodyText = htmlToText((await sourceResponse.text()).slice(0, MAX_BODY_CHARS * 3)).slice(0, MAX_BODY_CHARS);
    if (bodyText.length < 500) return response.status(422).json({ status: "body_too_short" });

    const result = await analyzeArticle(article, bodyText);
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, { method: "PATCH", body: { summary_ko: result.summary_ko, verification_status: "pending_review", updated_at: new Date().toISOString() } });
    if (result.timeline_eligibility !== "exclude" && result.occurred_at) {
      await supabaseRest("event", { method: "POST", body: {
        company_id: companyId, article_id: articleId, occurred_at: result.occurred_at,
        title_ko: result.event_title_ko, fact_ko: result.event_fact_ko,
        trajectory_track: result.trajectory_track, layer_key: result.layer_key,
        region_scope: result.region_scope, source_url: article.canonical_url, source_name: article.source_name,
        original_excerpt: result.original_excerpt, original_excerpt_ko: result.original_excerpt_ko,
        timeline_eligibility: result.timeline_eligibility
      } });
    }
    return response.status(200).json({ status: "pending_review", analysis: result });
  } catch (error) {
    return response.status(502).json({ status: "processing_failed", message: error.message });
  }
}
