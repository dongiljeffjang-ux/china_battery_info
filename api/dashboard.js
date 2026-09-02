import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { requireAccess } from "./lib/access.js";
import { sankeyFlowsFromArticles } from "../lib/sankey-normalization.js";

async function dashboardQuery(name, path) {
  try {
    return await supabaseRest(path);
  } catch (error) {
    console.error("[DASHBOARD_QUERY_FAILED]", JSON.stringify({ name, message: error.message }));
    return [];
  }
}

export default async function handler(request, response) {
  if (!requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) {
    return response.status(503).json({ status: "not_configured", message: "SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." });
  }
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.from || "") ? request.query.from : "2000-01-01";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.to || "") ? request.query.to : "2100-01-01";
    const [reports, top10, companyNews, pendingNews, flowEvents] = await Promise.all([
      dashboardQuery("report", "daily_report?select=report_date,summary_ko,generated_at,status&status=eq.published&order=report_date.desc&limit=1"),
      dashboardQuery("top10", "article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,top10_rank,article_company(company_id,company(name_ko,type_tags))&is_top10=eq.true&verification_status=in.(pending_review,approved)&order=top10_rank.asc&limit=10"),
      dashboardQuery("company_news", "article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,article_company(company_id,company(name_ko,type_tags))&verification_status=in.(pending_review,approved)&order=published_at.desc&limit=100"),
      dashboardQuery("raw_pending", "article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,article_company(company_id,company(name_ko,type_tags))&verification_status=eq.pending&order=published_at.desc&limit=100"),
      dashboardQuery("sankey", `article?select=id,published_at,keywords_ko,is_top10,verification_status,article_company(company_id)&published_at=gte.${from}&published_at=lte.${to}&verification_status=in.(pending_review,approved)&is_top10=eq.false&order=published_at.desc&limit=500`),
    ]);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    const flows = sankeyFlowsFromArticles(flowEvents);
    return response.status(200).json({ status: "ok", report: reports[0] || null, top10, companyNews, pendingNews, flows, counts: { top10: top10.length, company_verified: companyNews.length, raw_pending: pendingNews.length } });
  } catch (error) {
    return response.status(502).json({ status: error.code || "db_error", message: "Dashboard data could not be loaded." });
  }
}
