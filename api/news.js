const FINLIGHT_URL = "https://api.finlight.me/v2/articles";
const QUERY = "宁德时代 OR CATL OR 比亚迪 OR BYD OR 容百科技 OR Ronbay OR 湖南裕能 OR Hunan Yuneng OR 贝特瑞 OR BTR OR 杉杉股份 OR Shanshan OR 璞泰来 OR Putailai OR 中科电气 OR Zhongke Electric";

export default async function handler(request, response) {
  const apiKey = process.env.FINLIGHT_API_KEY;
  if (!apiKey) {
    return response.status(503).json({
      status: "disabled",
      message: "FINLIGHT_API_KEY가 설정되지 않았습니다.",
      articles: [],
    });
  }

  try {
    const upstream = await fetch(FINLIGHT_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        query: QUERY,
        categories: ["business", "technology", "energy", "commodities", "regulation"],
        orderBy: "publishDate",
        order: "DESC",
        pageSize: 100,
      }),
    });
    if (!upstream.ok) {
      return response.status(502).json({ status: "upstream_error", articles: [] });
    }
    const payload = await upstream.json();
    const articles = (payload.articles || []).map((article) => ({
      title: article.title,
      url: article.link,
      source: article.source,
      publishedAt: article.publishDate,
      snippet: article.summary || "",
      categories: article.categories || [],
      language: article.language,
    }));
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json({ status: "ok", articles });
  } catch {
    return response.status(502).json({ status: "upstream_error", articles: [] });
  }
}
