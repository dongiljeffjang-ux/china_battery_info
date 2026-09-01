import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";

export default async function handler(request, response) {
  if (!hasDatabaseConfig()) {
    return response.status(503).json({ status: "not_configured", message: "SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." });
  }
  try {
    const [reports, top10, companyNews, pendingNews] = await Promise.all([
      supabaseRest("daily_report?select=report_date,summary_ko,generated_at,status&status=eq.published&order=report_date.desc&limit=1"),
      supabaseRest("article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,top10_rank,article_company(company_id,company(name_ko,type_tags))&is_top10=eq.true&verification_status=eq.approved&order=top10_rank.asc&limit=10"),
      supabaseRest("article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,article_company(company_id,company(name_ko,type_tags))&verification_status=eq.approved&order=published_at.desc&limit=100"),
      supabaseRest("article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,article_company(company_id,company(name_ko,type_tags))&verification_status=eq.pending&order=published_at.desc&limit=100"),
    ]);
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    return response.status(200).json({ status: "ok", report: reports[0] || null, top10, companyNews, pendingNews });
  } catch (error) {
    return response.status(502).json({ status: error.code || "db_error", message: "Dashboard data could not be loaded." });
  }
}
