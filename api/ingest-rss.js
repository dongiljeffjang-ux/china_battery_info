import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { requireAccess } from "./lib/access.js";
import { processPendingArticle } from "./process-article.js";
import { generateDailyReport } from "./generate-daily.js";
import { COMPANIES, companiesFor, discoverChinaSources } from "../lib/china-sources.js";
import { llmConfig } from "../lib/llm-provider.js";
import { backfillCompanyEvents } from "../lib/event-backfill.js";

export const maxDuration = 60;

const TOP10_LIMIT = 10;
const PROCESS_CONCURRENCY = 3;
// 60초 함수 안에서 검색 1회 + 추출이 끝나야 하므로 회사당 건수를 낮춘다.
const BACKFILL_MAX_EVENTS = 12;
const BACKFILL_SINCE = "2023-01-01";
const HIGH_SIGNAL_TERMS = [
  "扩产", "增产", "产能", "投产", "开工", "项目", "签约", "订单", "定点", "认证", "量产", "出货", "交付",
  "营收", "收入", "净利润", "财报", "业绩", "海外", "建厂", "投资", "收购", "合作", "固态", "硅碳", "lmfp",
  "磷酸锰铁锂", "钠电", "专利", "标准", "回收", "capacity", "production", "order", "certification", "shipment",
  "revenue", "overseas", "investment", "acquisition", "solid-state", "silicon"
];
const LOW_SIGNAL_TERMS = ["视频", "faq", "值不值", "广告", "车主", "落地价", "车型", "测评", "评测", "怎么买", "怎么选", "对比", "续航"];

function isCronRequest(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function normalizeHeadline(title = "") {
  return title.toLowerCase().replace(/\s+/g, " ").replace(/[\p{P}\p{S}]/gu, "").trim();
}

function safePublishedAt(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function headlineScore(article) {
  const title = (article.title_original || "").toLowerCase();
  const highSignals = HIGH_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const lowSignals = LOW_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const ageDays = Math.max(0, (Date.now() - new Date(article.published_at || Date.now()).getTime()) / 86400000);
  return (highSignals * 20) - (lowSignals * 45) + (article.article_company?.length ? 3 : 0) - Math.min(ageDays, 30) / 10;
}

async function selectHeadlineTop10() {
  const rows = await supabaseRest("article?select=id,title_original,source_name,source_tier,published_at,article_company(company_id)&verification_status=eq.pending&order=published_at.desc&limit=500");
  const unique = new Map();
  for (const article of rows) {
    const key = normalizeHeadline(article.title_original);
    if (key && !unique.has(key)) unique.set(key, article);
  }
  return [...unique.values()]
    .filter((article) => article.source_tier.startsWith("web_search_") || article.source_name === "CATL Newsroom")
    .map((article) => ({ ...article, headline_score: headlineScore(article) }))
    .sort((a, b) => b.headline_score - a.headline_score || new Date(b.published_at) - new Date(a.published_at))
    .slice(0, TOP10_LIMIT);
}

async function processSelectedBatch(rows) {
  const outcomes = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROCESS_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      const article = rows[next++];
      const companyId = article.article_company?.[0]?.company_id;
      if (!companyId) continue;
      try {
        outcomes.push({ articleId: article.id, ...(await processPendingArticle(article.id, companyId)) });
      } catch (error) {
        console.error("[ARTICLE_PROCESS_FAILED]", JSON.stringify({ articleId: article.id, source: article.source_name, message: error.message }));
        outcomes.push({ articleId: article.id, status: "processing_failed", message: error.message });
      }
    }
  }));
  return outcomes;
}

// 과거 시계열 백필. 회사 1곳씩 호출한다.
// 파이프라인 이벤트와 달리 article_id가 없고 timeline_eligibility가 reference라 구분된다.
async function runBackfill(response, companyId, sinceParam) {
  const company = COMPANIES.find((item) => item.id === companyId);
  if (!company) return response.status(404).json({ status: "unknown_company", company_id: companyId });
  if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam || "") ? sinceParam : BACKFILL_SINCE;
  const until = new Date().toISOString().slice(0, 10);
  try {
    const { rows, dropped, returned, provider } = await backfillCompanyEvents({ company, since, until, maxEvents: BACKFILL_MAX_EVENTS });
    const existing = await supabaseRest(`event?select=occurred_at,title_ko&company_id=eq.${encodeURIComponent(companyId)}`);
    const eventKey = (row) => JSON.stringify([row.occurred_at, row.title_ko]);
    const seen = new Set(existing.map(eventKey));
    const fresh = rows.filter((row) => !seen.has(eventKey(row)));
    if (fresh.length) await supabaseRest("event", { method: "POST", prefer: "return=minimal", body: fresh });
    console.info("[BACKFILL_DONE]", JSON.stringify({ companyId, returned, kept: rows.length, inserted: fresh.length, dropped }));
    return response.status(200).json({ status: "ok", company_id: companyId, company_name: company.name_ko, since, until, returned, kept: rows.length, inserted: fresh.length, duplicates: rows.length - fresh.length, dropped, provider });
  } catch (error) {
    console.error("[BACKFILL_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: "backfill_failed", company_id: companyId, message: error.message });
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isCronRequest(request) && !requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  const backfillCompanyId = String(request.query?.backfill || request.body?.backfill || "").trim();
  if (backfillCompanyId) return runBackfill(response, backfillCompanyId, request.query?.since || request.body?.since);
  let stage = "company_seed";
  try {
    await supabaseRest("company?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: COMPANIES.map(({ id, name_ko, name_zh, name_en, type_tags }) => ({ id, name_ko, name_zh, name_en, type_tags })) });
    stage = "source_collection";
    const candidates = await discoverChinaSources();
    stage = "company_matching";
    const matchedCandidates = candidates
      .map((candidate) => ({ candidate, companies: companiesFor(candidate) }))
      .filter(({ companies }) => companies.length);
    const articleRows = matchedCandidates.map(({ candidate }) => ({
        canonical_url: candidate.url, source_name: candidate.source, title_original: candidate.title,
        source_language: "zh", published_at: safePublishedAt(candidate.publishedAt),
        verification_status: "pending", source_tier: candidate.kind === "disclosure" ? "official_disclosure" : candidate.kind === "web_search_news" ? `web_search_${candidate.searchProvider || "discovered"}` : "needs_review"
    }));
    stage = "article_storage";
    const storedArticles = articleRows.length
      ? await supabaseRest("article?on_conflict=canonical_url", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: articleRows })
      : [];
    const idByUrl = new Map(storedArticles.map((article) => [article.canonical_url, article.id]));
    const companyLinks = matchedCandidates.flatMap(({ candidate, companies }) =>
      companies.map((company) => ({ article_id: idByUrl.get(candidate.url), company_id: company.id }))
    ).filter((link) => link.article_id);
    stage = "company_linking";
    if (companyLinks.length) {
      await supabaseRest("article_company?on_conflict=article_id,company_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: companyLinks });
    }
    stage = "headline_selection";
    const immediateAnalysis = request.query?.process === "1" || request.body?.process === true;
    const shouldProcess = isCronRequest(request) || immediateAnalysis;
    const selectedHeadlines = shouldProcess ? await selectHeadlineTop10() : [];
    stage = "article_analysis";
    const llmResults = shouldProcess && (process.env.DEEPSEEK_API_KEY || (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL))
      ? await processSelectedBatch(selectedHeadlines)
      : [];
    const processedIds = llmResults.filter((result) => result.status === "pending_review").map((result) => result.articleId);
    const outcomeCounts = llmResults.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] || 0) + 1 }), {});
    console.info("[INGEST_OUTCOMES]", JSON.stringify({ selected: selectedHeadlines.length, outcomes: outcomeCounts }));
    stage = "daily_report";
    const dailyReport = processedIds.length && (process.env.DEEPSEEK_API_KEY || (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL))
      ? await generateDailyReport(processedIds)
      : null;
    return response.status(200).json({
      status: "ok", search_runs: (llmConfig("openai") ? 3 : 0) + (llmConfig("deepseek") ? 3 : 0), discovered: candidates.length, stored: storedArticles.length,
      headline_selected: selectedHeadlines.length,
      llm_processed: llmResults.filter((result) => result.status === "pending_review").length,
      outcome_counts: outcomeCounts,
      llm_results: llmResults,
      daily_report: dailyReport,
      next_step: shouldProcess ? "Headline-based Top 10 selection, body reading, Korean fact summarization, and Daily report generation have run." : "Use process=1 or the scheduled cron to run the Daily analysis."
    });
  } catch (error) {
    console.error("[INGESTION_FAILED]", JSON.stringify({ stage, message: error.message }));
    return response.status(502).json({ status: "ingestion_failed", stage, message: error.message });
  }
}
