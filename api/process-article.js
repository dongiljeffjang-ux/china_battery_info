import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { resolveGoogleNewsUrl } from "./lib/google-news.js";

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
    required: ["title_ko", "summary_ko", "keywords_ko", "event_title_ko", "event_fact_ko", "original_excerpt", "original_excerpt_ko", "occurred_at", "trajectory_track", "layer_key", "region_scope", "timeline_eligibility", "confidence_note"],
    properties: {
      title_ko: { type: "string" },
      keywords_ko: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
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
      instructions: "중국 배터리 산업 기사에서 출처에 명시된 사실만 한국어로 구조화한다. 전망·인과 추정·성공 가능성을 만들지 않는다. keywords_ko에는 헤드라인과 본문 요약을 대표하는 짧은 한국어 핵심 키워드 1~3개만 넣는다(예: 증설, 고객 인증, 실리콘 음극, 해외 생산). 단일 제3자 언론 기사만으로는 timeline_eligibility를 core로 두지 않는다. original_excerpt에는 핵심 근거 원문을 300자 이내로만 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다.",
      input,
      text: { format: { type: "json_schema", name: "battery_article_event", strict: true, schema } }
    })
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`OPENAI_${upstream.status}: ${detail}`);
  }
  const payload = await upstream.json();
  return JSON.parse(payload.output_text);
}

export async function processPendingArticle(articleId, companyId) {
  const articles = await supabaseRest(`article?select=id,canonical_url,title_original,source_name,published_at,source_tier&id=eq.${encodeURIComponent(articleId)}&verification_status=eq.pending&limit=1`);
  const article = articles[0];
  if (!article) return { status: "not_pending" };
  const resolvedUrl = await resolveGoogleNewsUrl(article.canonical_url);
  const sourceResponse = await fetch(resolvedUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)" } });
  const contentType = sourceResponse.headers.get("content-type") || "";
  if (!sourceResponse.ok || !contentType.includes("text/html")) return { status: "body_unavailable", contentType };
  const bodyText = htmlToText(await sourceResponse.text()).slice(0, MAX_BODY_CHARS);
  if (bodyText.length < 500) return { status: "body_too_short" };

  const result = await analyzeArticle(article, bodyText);
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH",
    body: { title_ko: result.title_ko, summary_ko: result.summary_ko, keywords_ko: result.keywords_ko, verification_status: "pending_review", updated_at: new Date().toISOString() }
  });
  if (result.timeline_eligibility !== "exclude" && result.occurred_at) {
    await supabaseRest("event", { method: "POST", body: {
      company_id: companyId, article_id: articleId, occurred_at: result.occurred_at,
      title_ko: result.event_title_ko, fact_ko: result.event_fact_ko,
      trajectory_track: result.trajectory_track, layer_key: result.layer_key,
      region_scope: result.region_scope, source_url: resolvedUrl, source_name: article.source_name,
      original_excerpt: result.original_excerpt, original_excerpt_ko: result.original_excerpt_ko,
      timeline_eligibility: result.timeline_eligibility
    } });
  }
  return { status: "pending_review", analysis: result };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });

  const articleId = String(request.body?.articleId || "").trim();
  const companyId = String(request.body?.companyId || "").trim();
  if (!articleId || !companyId) return response.status(400).json({ status: "invalid_request", message: "articleId and companyId are required." });

  try {
    const result = await processPendingArticle(articleId, companyId);
    return response.status(result.status === "pending_review" ? 200 : 422).json(result);
  } catch (error) {
    return response.status(502).json({ status: "processing_failed", message: error.message });
  }
}
