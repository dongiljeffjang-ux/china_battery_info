import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

export default async function handler(request, response) {
  const companyId = String(request.query.companyId || "").trim();
  if (!companyId) return response.status(400).json({ status: "invalid_request", message: "companyId is required." });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
  try {
    const [company, events] = await Promise.all([
      supabaseRest(`company?select=id,name_ko,name_zh,name_en,type_tags&id=eq.${encodeURIComponent(companyId)}&limit=1`),
      supabaseRest(`event?select=id,occurred_at,title_ko,fact_ko,trajectory_track,layer_key,region_scope,source_url,source_name,original_excerpt,original_excerpt_ko,timeline_eligibility,article(canonical_url,source_name,source_tier)&company_id=eq.${encodeURIComponent(companyId)}&timeline_eligibility=neq.exclude&order=occurred_at.asc`),
    ]);
    return response.status(200).json({ status: "ok", company: company[0] || null, events });
  } catch (error) {
    return response.status(502).json({ status: error.code || "db_error" });
  }
}
