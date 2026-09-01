import { requireAccess } from "./lib/access.js";
import { companiesFor, discoverChinaSources } from "../lib/china-sources.js";

export default async function handler(request, response) {
  if (!requireAccess(request, response)) return;
  try {
    const candidates = await discoverChinaSources();
    const unique = candidates
      .map((article) => ({ ...article, companies: companiesFor(article).map((company) => company.id), language: "zh" }))
      .filter((article) => article.companies.length);
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json({ status: "ok", articles: unique });
  } catch (error) {
    return response.status(502).json({ status: "upstream_error", message: String(error), articles: [] });
  }
}
