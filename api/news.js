const QUERIES = [
  "宁德时代 OR CATL 电池", "比亚迪 OR BYD 电池",
  "容百科技 OR Ronbay 正极", "湖南裕能 OR Hunan Yuneng 正极",
  "贝特瑞 OR BTR 负极", "杉杉股份 OR Shanshan 负极",
  "璞泰来 OR Putailai 负极", "中科电气 OR Zhongke Electric 负极",
];

function clean(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const field = (name) => clean(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] || "");
    return { title: field("title"), url: field("link"), publishedAt: field("pubDate"), snippet: field("description"), source: "Google News RSS", language: "zh" };
  }).filter((article) => article.title && article.url);
}

export default async function handler(request, response) {
  try {
    const results = await Promise.all(QUERIES.map(async (query) => {
      const params = new URLSearchParams({ q: query, hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" });
      const upstream = await fetch(`https://news.google.com/rss/search?${params}`);
      if (!upstream.ok) throw new Error(`RSS ${upstream.status}`);
      return parseRss(await upstream.text());
    }));
    const unique = [...new Map(results.flat().map((article) => [article.url, article])).values()];
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json({ status: "ok", articles: unique });
  } catch (error) {
    return response.status(502).json({ status: "upstream_error", message: String(error), articles: [] });
  }
}
