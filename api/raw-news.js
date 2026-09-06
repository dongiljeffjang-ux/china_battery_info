import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { requireAccess } from "../lib/access.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ status: "method_not_allowed" });
  if (!requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
  try {
    const articles = await supabaseRest("article?select=id,title_original,title_ko,canonical_url,source_name,source_language,published_at,summary_ko,keywords_ko,verification_status,source_tier,is_top10,top10_rank,article_company(company_id,company(name_ko,type_tags))&order=published_at.desc&limit=1000");
    return response.status(200).json({ status: "ok", articles });
  } catch (error) {
    return response.status(502).json({ status: "raw_export_failed" });
  }
}
