import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { requireAccess } from "../lib/access.js";
import { sankeyFlowsFromArticles } from "../lib/sankey-normalization.js";
import { normalizeStoredReport } from '../lib/report-classification.js';

// 조회 하나가 실패해도 나머지는 보여주되, 무엇이 왜 실패했는지는 응답에 실어 화면이 알게 한다.
// 조용히 빈 배열을 돌려주면 화면은 "기사 없음"으로 보이고 원인을 추적할 수 없다.
async function dashboardQuery(name, path, errors) {
  try {
    return await supabaseRest(path);
  } catch (error) {
    console.error("[DASHBOARD_QUERY_FAILED]", JSON.stringify({ name, message: error.message }));
    errors.push({ name, message: String(error.message || error).slice(0, 200) });
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
    const toInput = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.to || "") ? request.query.to : "2100-01-01";
    // published_at은 타임스탬프다. lte.<날짜>로 비교하면 그 날 00:00만 걸려
    // 같은 날 오후에 나온 기사가 조용히 빠진다. 종료일 다음 날 자정 미만으로 본다.
    const toBound = new Date(`${toInput}T00:00:00Z`);
    toBound.setUTCDate(toBound.getUTCDate() + 1);
    const to = toBound.toISOString().slice(0, 10);
    // 회사별 뉴스는 기본이 오늘 하루다. 지난 것까지 보고 싶을 때만 화면이 기간을 넓혀 준다.
    // 종료일은 그날 자정 이후 기사가 빠지지 않도록 다음 날 0시 미만으로 본다.
    const koreaDay = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + offsetDays * 86400000));
    const today = koreaDay();
    // 수집이 밤 23시에 돌아 이른 시간에는 오늘 기사가 아직 없다. 기본을 어제부터로 잡는다.
    const newsFrom = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.newsFrom || "") ? request.query.newsFrom : koreaDay(-3);
    const newsToInput = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.newsTo || "") ? request.query.newsTo : today;
    const newsToBound = new Date(`${newsToInput}T00:00:00Z`);
    newsToBound.setUTCDate(newsToBound.getUTCDate() + 1);
    const newsTo = newsToBound.toISOString().slice(0, 10);

    const errors = [];
    // ?report=YYYY-MM-DD를 주면 그날 리포트를, 없으면 가장 최근 리포트를 돌려준다.
    // 지난 리포트는 사라지지 않고 날짜별로 쌓이므로 목록도 함께 실어 화면이 고를 수 있게 한다.
    const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(request.query?.report || "") ? request.query.report : null;
    const reportPath = reportDate
      ? `daily_report?select=report_date,summary_ko,insight_ko,generated_at,status&status=eq.published&report_date=eq.${reportDate}&limit=1`
      : "daily_report?select=report_date,summary_ko,insight_ko,generated_at,status&status=eq.published&order=report_date.desc&limit=1";
    const [reports, reportDates, top10, companyNews, pendingNews, flowEvents, flowHeadlines] = await Promise.all([
      dashboardQuery("report", reportPath, errors),
      dashboardQuery("report_dates", "daily_report?select=report_date&status=eq.published&order=report_date.desc&limit=90", errors),
      dashboardQuery("top10", "article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,top10_rank,article_company(company_id,company(name_ko,type_tags))&is_top10=eq.true&verification_status=in.(verified,approved)&order=top10_rank.asc&limit=10", errors),
      dashboardQuery("company_news", `article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,is_top10,top10_rank,article_company(company_id,company(name_ko,type_tags))&verification_status=in.(verified,approved)&published_at=gte.${newsFrom}&published_at=lt.${newsTo}&order=published_at.desc&limit=300`, errors),
      dashboardQuery("raw_pending", "article?select=id,title_ko,title_original,canonical_url,source_name,published_at,summary_ko,source_tier,verification_status,article_company(company_id,company(name_ko,type_tags))&verification_status=eq.pending&order=published_at.desc&limit=100", errors),
      dashboardQuery("sankey", `article?select=id,title_ko,title_original,summary_ko,published_at,keywords_ko,headline_signals,is_top10,verification_status,article_company(company_id)&published_at=gte.${from}&published_at=lt.${to}&verification_status=in.(verified,approved)&is_top10=eq.false&order=published_at.desc&limit=500`, errors),
      // 본문을 읽지 않은 수집 기사. 야간 큐레이션이 제목을 한국어로 옮긴 것만 title_ko가 있다.
      // 검증 기사만으로는 하루 50건 남짓이라 산업 전반의 확대/축소를 보기엔 얇았다.
      dashboardQuery("sankey_headlines", `article?select=id,title_ko,title_original,published_at,article_company(company_id)&published_at=gte.${from}&published_at=lt.${to}&verification_status=eq.pending&title_ko=not.is.null&order=published_at.desc&limit=800`, errors),
    ]);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    const flows = sankeyFlowsFromArticles(flowEvents, flowHeadlines);
    return response.status(200).json({
      status: "ok", errors, range: { from, to }, news_range: { from: newsFrom, to: newsToInput },
      report: reports[0] ? {...reports[0], summary_ko: normalizeStoredReport(reports[0].summary_ko)} : null,
      report_dates: (reportDates || []).map((row) => row.report_date),
      requested_report: reportDate,
      top10, companyNews, pendingNews, flows,
      counts: { top10: top10.length, company_verified: companyNews.length, raw_pending: pendingNews.length, sankey_verified: flowEvents.length, sankey_headlines: flowHeadlines.length },
    });
  } catch (error) {
    return response.status(502).json({ status: error.code || "db_error", message: "Dashboard data could not be loaded." });
  }
}
