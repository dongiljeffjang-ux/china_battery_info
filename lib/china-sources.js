const SINA_FINANCE_URL = "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50&page=";
const CHINA_NEWS_RSS = "https://www.chinanews.com.cn/rss/finance.xml";
const PEOPLE_FINANCE_RSS = "https://www.people.com.cn/rss/finance.xml";
import { createJsonResponse, llmConfig } from "./llm-provider.js";

export const COMPANIES = [
  { id: "catl", name_ko: "CATL", name_zh: "宁德时代", name_en: "Contemporary Amperex Technology", type_tags: ["cell"], aliases: ["宁德时代", "CATL", "Contemporary Amperex Technology"], cninfo: { column: "szse", query: "宁德时代" } },
  { id: "byd", name_ko: "BYD", name_zh: "比亚迪", name_en: "BYD", type_tags: ["cell"], aliases: ["比亚迪", "BYD", "刀片电池", "Blade Battery"], cninfo: { column: "szse", query: "比亚迪" } },
  { id: "ronbay", name_ko: "룽바이(Ronbay)", name_zh: "容百科技", name_en: "Ronbay", type_tags: ["cathode"], aliases: ["容百科技", "Ronbay", "Ningbo Ronbay"], cninfo: { column: "sse", query: "容百科技" } },
  { id: "hunan-yuneng", name_ko: "후난위넝", name_zh: "湖南裕能", name_en: "Hunan Yuneng", type_tags: ["cathode"], aliases: ["湖南裕能", "Hunan Yuneng"], cninfo: { column: "szse", query: "湖南裕能" } },
  { id: "btr", name_ko: "BTR", name_zh: "贝特瑞", name_en: "BTR", type_tags: ["anode"], aliases: ["贝特瑞", "BTR", "Beijing BTR"], cninfo: { column: "neeq", query: "贝特瑞" } },
  { id: "shanshan", name_ko: "샨샨", name_zh: "杉杉股份", name_en: "Shanshan", type_tags: ["anode"], aliases: ["杉杉股份", "Shanshan"], cninfo: { column: "sse", query: "杉杉股份" } },
  { id: "putailai", name_ko: "푸타이라이", name_zh: "璞泰来", name_en: "Putailai", type_tags: ["anode"], aliases: ["璞泰来", "Putailai", "Zichen"], cninfo: { column: "sse", query: "璞泰来" } },
  { id: "zhongke-electric", name_ko: "중커전기", name_zh: "中科电气", name_en: "Zhongke Electric", type_tags: ["anode"], aliases: ["中科电气", "Zhongke Electric", "Zhongke Xingcheng"], cninfo: { column: "szse", query: "中科电气" } },
];

function clean(value = "") { return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }

function parseRss(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1]; const field = (name) => clean(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]);
    return { source, title: field("title"), url: field("link"), publishedAt: field("pubDate"), snippet: field("description"), kind: "news" };
  }).filter((item) => item.title && item.url);
}

function unixDate(value) { const seconds = Number(value); return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString(); }

async function fetchRss(url, source) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)" } });
  return response.ok ? parseRss(await response.text(), source) : [];
}

async function fetchSinaFinance() {
  const pages = await Promise.all([1, 2].map(async (page) => {
    const response = await fetch(`${SINA_FINANCE_URL}${page}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)" } });
    if (!response.ok) return []; const payload = await response.json();
    return (payload.result?.data || []).map((item) => ({ source: "Sina Finance", title: clean(item.title), url: item.url || item.wapurl, publishedAt: unixDate(item.ctime || item.intime), snippet: clean(item.intro || item.summary || item.wapsummary), kind: "news" })).filter((item) => item.title && item.url);
  })); return pages.flat();
}

async function fetchCatlNewsroom() {
  const response = await fetch("https://www.catl.com/news/", { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)" } });
  if (!response.ok) return []; const html = await response.text();
  const items = [...html.matchAll(/<a href="(\/news\/\d+\.html)"[^>]*>[\s\S]*?<p[^>]*class="mc_e1_txt"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<div[^>]*class="mc_e1_date"[^>]*>([\s\S]*?)<\/div>/g)];
  return items.map((match) => ({ source: "CATL Newsroom", title: clean(match[2]), url: new URL(match[1], "https://www.catl.com").toString(), publishedAt: clean(match[3]), snippet: "宁德时代 공식 뉴스룸 발표", kind: "news", companyId: "catl" })).filter((item) => item.title && item.url);
}

function koreaDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

async function discoverWebSearchNews() {
  if (!llmConfig()) return [];
  const until = koreaDate();
  const since = koreaDate(new Date(Date.now() - 3 * 86400000));
  const groups = [
    { label: "배터리 셀", ids: ["catl", "byd"] },
    { label: "양극재", ids: ["ronbay", "hunan-yuneng"] },
    { label: "음극재", ids: ["btr", "shanshan", "putailai", "zhongke-electric"] }
  ];
  const schema = {
    type: "object", additionalProperties: false, required: ["articles"],
    properties: { articles: { type: "array", maxItems: 12, items: {
      type: "object", additionalProperties: false,
      required: ["title", "url", "source_name", "published_at", "snippet"],
      properties: {
        title: { type: "string" }, url: { type: "string" }, source_name: { type: "string" },
        published_at: { type: ["string", "null"] }, snippet: { type: "string" }
      }
    } } }
  };
  const results = await Promise.all(groups.map(async (group) => {
    try {
      const names = group.ids.map((id) => {
        const company = COMPANIES.find((item) => item.id === id);
        return `${company.name_zh}(${company.name_en})`;
      }).join("、");
      const { data, sourceUrls, provider } = await createJsonResponse({
        name: "china_battery_news_candidates", schema, webSearch: true,
        instructions: "중국 이차전지 산업 뉴스 리서처다. 웹 검색을 이용한다. 검색 결과에 실제로 제시된 원문 기사 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다. 광고, 자동차 소비자 리뷰, 주가 단신은 제외한다. 중국어/영어 원문 모두 가능하다.",
        input: `${since}부터 ${until}까지 ${group.label} 기업(${names})의 사업·생산·증설·수주·고객·기술·재무·해외 전략과 직접 관련된 기사 후보를 최대 12건 찾으세요. 각 기사에는 제목, 원문 URL, 원 매체명, 발행일(모르면 null), 검색 결과에 보이는 1~2문장 요약을 반환하세요.`
      });
      return { articles: data.articles || [], sourceUrls, provider };
    } catch (error) {
      console.error("[WEB_SEARCH_FAILED]", error.message);
      return { articles: [], sourceUrls: [], provider: "unknown" };
    }
  }));
  return results.flatMap(({ articles, sourceUrls, provider }) => articles.map((item) => ({ ...item, sourceUrls, provider }))).map((item) => {
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol)) return null;
      const matchesCitation = !item.sourceUrls.length || item.sourceUrls.some((sourceUrl) => {
        try { return new URL(sourceUrl).hostname === url.hostname; } catch { return false; }
      });
      if (!matchesCitation) return null;
      return { source: item.source_name || "Web news", title: clean(item.title), url: url.toString(), publishedAt: item.published_at || new Date().toISOString(), snippet: clean(item.snippet), kind: "web_search_news", searchProvider: item.provider };
    } catch { return null; }
  }).filter(Boolean);
}

function cninfoDateRange(days = 14) { const end = new Date(); const start = new Date(end.getTime() - days * 86400000); const format = (value) => value.toISOString().slice(0, 10); return `${format(start)}~${format(end)}`; }

async function fetchCninfo(company) {
  const params = new URLSearchParams({ pageNum: "1", pageSize: "20", tabName: "fulltext", column: company.cninfo.column, stock: "", searchkey: company.cninfo.query, secid: "", plate: "", category: "", trade: "", seDate: cninfoDateRange(), sortName: "", sortType: "", isHLtitle: "true" });
  const response = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", { method: "POST", headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)", "Referer": "https://www.cninfo.com.cn/", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body: params });
  if (!response.ok) return []; const payload = await response.json();
  return (payload.announcements || []).map((item) => ({ source: "CNINFO Disclosure", title: clean(item.announcementTitle), url: item.adjunctUrl ? `https://static.cninfo.com.cn/${item.adjunctUrl}` : "", publishedAt: item.announcementTime ? new Date(item.announcementTime).toISOString() : new Date().toISOString(), snippet: `${company.name_zh} (${item.secCode || ""}) 공식 공시`, kind: "disclosure", companyId: company.id })).filter((item) => item.title && item.url);
}

export async function discoverChinaSources() {
  const [webSearchNews, catlNews, ...disclosures] = await Promise.all([discoverWebSearchNews(), fetchCatlNewsroom(), ...COMPANIES.map(fetchCninfo)]);
  return [...new Map([...webSearchNews, ...catlNews, ...disclosures.flat()].map((item) => [item.url, item])).values()];
}

export function companiesFor(item) {
  if (item.companyId) return COMPANIES.filter((company) => company.id === item.companyId);
  const corpus = `${item.title} ${item.snippet}`.toLowerCase(); return COMPANIES.filter((company) => company.aliases.some((alias) => corpus.includes(alias.toLowerCase())));
}
