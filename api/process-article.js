import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { resolveGoogleNewsUrl } from "./lib/google-news.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { COMPANIES } from "../lib/china-sources.js";
import { groupSummary, matchGroupEntities } from "../lib/company-groups.js";
import { embedVerifiedArticle } from "../lib/vector-ingestion.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "../lib/timeline-layers.js";

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

async function analyzeArticle(article, bodyText, provider, companyContext = "") {
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
      layer_key: { type: "string", enum: LAYER_ENUM },
      region_scope: { type: ["string", "null"] },
      timeline_eligibility: { type: "string", enum: ["core", "reference", "exclude"] },
      confidence_note: { type: "string" }
    }
  };
  const input = `${companyContext}\n원문 제목: ${article.title_original}\n발행일: ${article.published_at || "미상"}\n매체: ${article.source_name}\n본문:\n${bodyText}`;
  const { data } = await createJsonResponse({
    name: "battery_article_event", schema,
    instructions: "중국 배터리 산업 기사에서 출처에 명시된 사실만 한국어로 구조화한다. 전망·인과 추정·성공 가능성을 만들지 않는다. 제공된 ‘서비스 표준 회사명’이 본문 주체와 일치하면 title_ko, summary_ko, event_title_ko, event_fact_ko에서 그 한국어 표준명을 반드시 사용한다. 원문 중국어·영어 법인명과 한국어 표준명을 섞어 새 이름을 만들지 않는다. keywords_ko에는 회사명 대신 사건을 대표하는 짧은 한국어 핵심 키워드 1~3개만 넣는다(예: 증설, 고객 인증, 실리콘 음극, 해외 생산). 단일 제3자 언론 기사만으로는 timeline_eligibility를 core로 두지 않는다. original_excerpt에는 핵심 근거 원문을 300자 이내로만 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다. " + LAYER_PROMPT_GUIDE,
    input, provider
  });
  return data;
}

async function factCheckArticle(article, bodyText, analysis, provider, companyContext = "") {
  const schema = {
    type: "object", additionalProperties: false, required: ["verdict", "title_ko", "summary_ko", "keywords_ko", "original_excerpt", "original_excerpt_ko", "reason_ko"],
    properties: {
      verdict: { type: "string", enum: ["pass", "reject"] }, title_ko: { type: "string" }, summary_ko: { type: "string" },
      keywords_ko: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
      original_excerpt: { type: "string" }, original_excerpt_ko: { type: "string" }, reason_ko: { type: "string" }
    }
  };
  const { data } = await createJsonResponse({
    name: "battery_article_fact_check", schema,
    instructions: "당신은 독립적인 사실 검증자다. 기사 본문만 증거로 사용한다. 제시된 1차 요약의 각 사실이 본문에 직접 있는지 대조한다. 추정·평가·인과관계·본문에 없는 수치·주체가 있으면 reject한다. pass일 때도 본문에서 확인되는 사실만 남긴 더 보수적인 한국어 제목·요약·키워드·300자 이내 원문 발췌 및 번역을 다시 작성한다. 제공된 서비스 표준 회사명과 본문 주체가 일치하면 한국어 제목·요약에서 반드시 그 표준명을 유지한다. 키워드에는 회사명을 넣지 않는다.",
    input: `${companyContext}\n기사 제목: ${article.title_original}\n본문:\n${bodyText}\n\n1차 분석 결과:\n${JSON.stringify(analysis)}`,
    provider
  });
  return data;
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
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH", body: { body_original: bodyText, body_fetched_at: new Date().toISOString(), embedding_status: "pending", updated_at: new Date().toISOString() }
  });

  const primaryProvider = llmConfig("openai") ? "openai" : "deepseek";
  const verifierProvider = llmConfig("deepseek") ? "deepseek" : primaryProvider;
  const company = COMPANIES.find((item) => item.id === companyId);
  const group = company ? groupSummary(company.id) : null;
  const companyContext = company ? `서비스 표준 회사명: ${company.name_ko}${group ? `
그룹: ${group.name_ko}
그룹 포함 검색 법인: ${group.members_ko.join(", ")}` : ""}` : "";
  const result = await analyzeArticle(article, bodyText, primaryProvider, companyContext);
  const factCheck = await factCheckArticle(article, bodyText, result, verifierProvider, companyContext);
  console.info("[ARTICLE_CROSS_CHECK]", JSON.stringify({ articleId, primaryProvider, verifierProvider, verdict: factCheck.verdict }));
  if (factCheck.verdict !== "pass") {
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, { method: "PATCH", body: { verification_status: "rejected", source_tier: "fact_check_rejected", updated_at: new Date().toISOString() } });
    return { status: "fact_check_rejected", reason: factCheck.reason_ko };
  }
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH",
    body: { title_ko: factCheck.title_ko, summary_ko: factCheck.summary_ko, keywords_ko: factCheck.keywords_ko, verification_status: "pending_review", source_tier: `${primaryProvider}_${verifierProvider}_fact_checked`, updated_at: new Date().toISOString() }
  });
  let embedding = { status: "skipped", chunks: 0 };
  try {
    embedding = await embedVerifiedArticle({
      article, companyId, bodyText, titleKo: factCheck.title_ko, summaryKo: factCheck.summary_ko,
      sourceUrl: resolvedUrl, sourceName: article.source_name, publishedAt: article.published_at
    });
  } catch (error) {
    console.error("[ARTICLE_EMBEDDING_FAILED]", JSON.stringify({ articleId, message: error.message }));
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
      method: "PATCH", body: { embedding_status: "failed", updated_at: new Date().toISOString() }
    });
    embedding = { status: "failed", chunks: 0 };
  }
  if (result.timeline_eligibility !== "exclude" && result.occurred_at) {
    // 발생 법인은 등록된 계열사 별칭 매칭으로만 정한다. 본문 전체가 아니라 이벤트 문장과
    // 근거 발췌만 대조해 각주·목록에 스치듯 나온 계열사가 섞이지 않게 한다.
    const entityNames = matchGroupEntities(companyId, [
      article.title_original, result.event_title_ko, result.event_fact_ko, factCheck.original_excerpt
    ].filter(Boolean).join(" "));
    await supabaseRest("event", { method: "POST", body: {
      entity_names: entityNames,
      company_id: companyId, article_id: articleId, occurred_at: result.occurred_at,
      title_ko: result.event_title_ko, fact_ko: result.event_fact_ko,
      trajectory_track: result.trajectory_track, layer_key: normalizeLayerKey(result.layer_key),
      region_scope: result.region_scope, source_url: resolvedUrl, source_name: article.source_name,
      original_excerpt: factCheck.original_excerpt, original_excerpt_ko: factCheck.original_excerpt_ko,
      timeline_eligibility: result.timeline_eligibility
    } });
  }
  return { status: "pending_review", analysis: result, fact_check: factCheck, embedding, primary_provider: primaryProvider, verifier_provider: verifierProvider };
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
