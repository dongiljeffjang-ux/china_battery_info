import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

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

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

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
  if (!authorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  try {
    await supabaseRest("company?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: COMPANIES.map(({ aliases, ...company }) => company) });
    const candidates = await discoverArticles();
    let stored = 0;
    for (const candidate of candidates) {
      const matches = companiesFor(candidate);
      if (!matches.length) continue;
      const rows = await supabaseRest("article?on_conflict=canonical_url", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: {
        canonical_url: candidate.url, source_name: candidate.source, title_original: candidate.title,
        source_language: "zh", published_at: new Date(candidate.publishedAt || Date.now()).toISOString(),
        verification_status: "pending", source_tier: "needs_review"
      } });
      const article = rows[0];
      for (const company of matches) {
        await supabaseRest("article_company?on_conflict=article_id,company_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { article_id: article.id, company_id: company.id } });
      }
      stored += 1;
    }
    return response.status(200).json({ status: "ok", discovered: candidates.length, stored, next_step: "Run /api/process-article for selected pending article IDs, then approve verified facts." });
  } catch (error) {
    return response.status(502).json({ status: "ingestion_failed", message: error.message });
  }
}
