import { requireAccess } from "./lib/access.js";
import { companiesFor, discoverChinaSources } from "../lib/china-sources.js";
import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

export default async function handler(request, response) {
  if (!requireAccess(request, response)) return;
  if (request.method === "POST") {
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
    const articleId = String(request.body?.articleId || "");
    const clientKey = String(request.body?.clientKey || "");
    const vote = request.body?.vote === "up" ? 1 : request.body?.vote === "down" ? -1 : 0;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(articleId) || !uuid.test(clientKey) || !vote) return response.status(400).json({ status: "invalid_feedback" });
    try {
      const saved = await supabaseRest("article_feedback?on_conflict=article_id,client_key", {
        method: "POST", prefer: "resolution=merge-duplicates,return=representation",
        body: { article_id: articleId, client_key: clientKey, vote, updated_at: new Date().toISOString() }
      });
      return response.status(200).json({ status: "saved", vote: saved?.[0]?.vote || vote });
    } catch (error) {
      console.error("[FEEDBACK_SAVE_FAILED]", JSON.stringify({ articleId, message: error.message }));
      return response.status(502).json({ status: "feedback_save_failed", message: error.message });
    }
  }
  if (request.method !== "GET") return response.status(405).json({ status: "method_not_allowed" });
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
