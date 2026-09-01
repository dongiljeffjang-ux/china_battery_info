import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { requireAccess } from "./lib/access.js";
import { processPendingArticle } from "./process-article.js";
import { generateDailyReport } from "./generate-daily.js";

export const maxDuration = 60;

const TOP10_LIMIT = 10;
const PROCESS_CONCURRENCY = 3;
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

function headlineScore(article) {
  const title = (article.title_original || "").toLowerCase();
  const highSignals = HIGH_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const lowSignals = LOW_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const ageDays = Math.max(0, (Date.now() - new Date(article.published_at || Date.now()).getTime()) / 86400000);
  return (highSignals * 20) - (lowSignals * 45) + (article.article_company?.length ? 3 : 0) - Math.min(ageDays, 30) / 10;
}

async function selectHeadlineTop10() {
  const rows = await supabaseRest("article?select=id,title_original,published_at,article_company(company_id)&verification_status=eq.pending&order=published_at.desc&limit=500");
  const unique = new Map();
  for (const article of rows) {
    const key = normalizeHeadline(article.title_original);
    if (key && !unique.has(key)) unique.set(key, article);
  }
  return [...unique.values()]
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
        outcomes.push({ articleId: article.id, status: "processing_failed", message: error.message });
      }
    }
  }));
  return outcomes;
}

const COMPANIES = [
  { id: "catl", name_ko: "CATL", name_zh: "宁德时代", name_en: "Contemporary Amperex Technology", type_tags: ["cell"], aliases: ["宁德时代", "CATL", "Contemporary Amperex Technology"] },
  { id: "byd", name_ko: "BYD", name_zh: "比亚迪", name_en: "BYD", type_tags: ["cell"], aliases: ["比亚迪", "BYD", "刀片电池", "Blade Battery"] },
  { id: "ronbay", name_ko: "룽바이(Ronbay)", name_zh: "容百科技", name_en: "Ronbay", type_tags: ["cathode"], aliases: ["容百科技", "Ronbay", "Ningbo Ronbay"] },
  { id: "hunan-yuneng", name_ko: "후난위넝", name_zh: "湖南裕能", name_en: "Hunan Yuneng", type_tags: ["cathode"], aliases: ["湖南裕能", "Hunan Yuneng"] },
  { id: "btr", name_ko: "BTR", name_zh: "贝特瑞", name_en: "BTR", type_tags: ["anode"], aliases: ["贝特瑞", "BTR", "Beijing BTR"] },
  { id: "shanshan", name_ko: "샨샨", name_zh: "杉杉股份", name_en: "Shanshan", type_tags: ["anode"], aliases: ["杉杉股份", "Shanshan"] },
  { id: "putailai", name_ko: "푸타이라이", name_zh: "璞泰来", name_en: "Putailai", type_tags: ["anode"], aliases: ["璞泰来", "Putailai", "Zichen"] },
  { id: "zhongke-electric", name_ko: "중커전기", name_zh: "中科电气", name_en: "Zhongke Electric", type_tags: ["anode"], aliases: ["中科电气", "Zhongke Electric", "Zhongke Xingcheng"] },
];

function clean(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const field = (name) => clean(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]);
    return { source, title: field("title"), url: field("link"), publishedAt: field("pubDate"), snippet: field("description") };
  }).filter((item) => item.title && item.url);
}

async function discoverArticles() {
  const queries = COMPANIES.map((company) => `${company.aliases.slice(0, 2).join(" OR ")} 电池 OR 正极 OR 负极`);
  const google = await Promise.all(queries.map(async (query) => {
    const params = new URLSearchParams({ q: query, hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" });
    const response = await fetch(`https://news.google.com/rss/search?${params}`);
    return response.ok ? parseRss(await response.text(), "Google News RSS") : [];
  }));
  const chinaNews = await fetch("https://www.chinanews.com.cn/rss/finance.xml");
  const official = chinaNews.ok ? parseRss(await chinaNews.text(), "China News Finance") : [];
  return [...new Map([...google.flat(), ...official].map((item) => [item.url, item])).values()];
}

function companiesFor(item) {
  const corpus = `${item.title} ${item.snippet}`.toLowerCase();
  return COMPANIES.filter((company) => company.aliases.some((alias) => corpus.includes(alias.toLowerCase())));
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isCronRequest(request) && !requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  try {
    await supabaseRest("company?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: COMPANIES.map(({ aliases, ...company }) => company) });
    const candidates = await discoverArticles();
    const matchedCandidates = candidates
      .map((candidate) => ({ candidate, companies: companiesFor(candidate) }))
      .filter(({ companies }) => companies.length);
    const articleRows = matchedCandidates.map(({ candidate }) => ({
        canonical_url: candidate.url, source_name: candidate.source, title_original: candidate.title,
        source_language: "zh", published_at: new Date(candidate.publishedAt || Date.now()).toISOString(),
        verification_status: "pending", source_tier: "needs_review"
    }));
    const storedArticles = articleRows.length
      ? await supabaseRest("article?on_conflict=canonical_url", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: articleRows })
      : [];
    const idByUrl = new Map(storedArticles.map((article) => [article.canonical_url, article.id]));
    const companyLinks = matchedCandidates.flatMap(({ candidate, companies }) =>
      companies.map((company) => ({ article_id: idByUrl.get(candidate.url), company_id: company.id }))
    ).filter((link) => link.article_id);
    if (companyLinks.length) {
      await supabaseRest("article_company?on_conflict=article_id,company_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: companyLinks });
    }
    const immediateAnalysis = request.query?.process === "1" || request.body?.process === true;
    const shouldProcess = isCronRequest(request) || immediateAnalysis;
    const selectedHeadlines = shouldProcess ? await selectHeadlineTop10() : [];
    const llmResults = shouldProcess && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
      ? await processSelectedBatch(selectedHeadlines)
      : [];
    const processedIds = llmResults.filter((result) => result.status === "pending_review").map((result) => result.articleId);
    const outcomeCounts = llmResults.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] || 0) + 1 }), {});
    console.info("[INGEST_OUTCOMES]", JSON.stringify({ selected: selectedHeadlines.length, outcomes: outcomeCounts }));
    const dailyReport = processedIds.length && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
      ? await generateDailyReport(processedIds)
      : null;
    return response.status(200).json({
      status: "ok", discovered: candidates.length, stored: storedArticles.length,
      headline_selected: selectedHeadlines.length,
      llm_processed: llmResults.filter((result) => result.status === "pending_review").length,
      outcome_counts: outcomeCounts,
      llm_results: llmResults,
      daily_report: dailyReport,
      next_step: shouldProcess ? "Headline-based Top 10 selection, body reading, Korean fact summarization, and Daily report generation have run." : "Use process=1 or the scheduled cron to run the Daily analysis."
    });
  } catch (error) {
    return response.status(502).json({ status: "ingestion_failed", message: error.message });
  }
}
