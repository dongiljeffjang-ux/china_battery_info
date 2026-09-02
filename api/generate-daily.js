import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";


function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

async function selectTop10(candidates, preferenceExamples = []) {
  const schema = {
    type: "object", additionalProperties: false, required: ["summary_ko", "top10"],
    properties: {
      summary_ko: { type: "string" },
      top10: { type: "array", maxItems: 10, items: {
        type: "object", additionalProperties: false, required: ["article_id", "rank", "selection_reason_ko"],
        properties: { article_id: { type: "string" }, rank: { type: "integer", minimum: 1, maximum: 10 }, selection_reason_ko: { type: "string" } }
      } }
    }
  };
  const evidence = candidates.map((article) => ({
    article_id: article.id, date: article.published_at, source: article.source_name,
    company: article.article_company?.map((link) => link.company?.name_ko).filter(Boolean),
    title_ko: article.title_ko, summary_ko: article.summary_ko
  }));
  const { data } = await createJsonResponse({
    name: "daily_top10", schema,
    instructions: "당신은 중국 이차전지 산업 데일리 편집자다. 제공된 본문 검증 완료 기사 요약만 근거로 중요도를 선별한다. 10개 이하를 선택한다. 단일 제3자 언론 보도만으로 확정할 수 없는 주장은 고르지 않는다. 회사의 직접 발표·공시 또는 복수 보도로 확인된 사업·기술·생산·고객·재무 변화를 우선한다. 사용자 피드백은 편집 선호의 보조 신호로만 사용하며, 사실성·출처 검증·중요도보다 우선하지 않는다. summary_ko는 한국어 1페이지 요약이며, 사실만 쓰고 전망·인과·투자 의견은 쓰지 않는다. selection_reason_ko는 선택된 원문의 확인 가능한 변화만 설명한다.",
    input: JSON.stringify({ candidates: evidence, preference_examples: preferenceExamples })
  });
  return data;
}

export async function generateDailyReport(articleIds = []) {
  const idFilter = articleIds.length ? `&id=in.(${articleIds.join(",")})` : "";
  const candidates = await supabaseRest(`article?select=id,title_ko,summary_ko,source_name,published_at,article_company(company(name_ko))&verification_status=eq.pending_review${idFilter}&order=published_at.desc&limit=80`);
  if (!candidates.length) return { status: "no_reviewed_articles" };
  let preferenceExamples = [];
  try {
    const feedbackRows = await supabaseRest("article_feedback?select=vote,article(title_ko,summary_ko,keywords_ko)&order=updated_at.desc&limit=100");
    preferenceExamples = feedbackRows.map((row) => ({
      preference: row.vote > 0 ? "좋아요" : "싫어요",
      title_ko: row.article?.title_ko || "", summary_ko: row.article?.summary_ko || "", keywords_ko: row.article?.keywords_ko || []
    })).filter((row) => row.title_ko || row.summary_ko);
  } catch (error) {
    console.error("[FEEDBACK_PROFILE_UNAVAILABLE]", error.message);
  }
  const result = await selectTop10(candidates, preferenceExamples);
  const candidateIds = new Set(candidates.map((article) => article.id));
  const selected = result.top10
    .filter((item) => candidateIds.has(item.article_id))
    .sort((a, b) => a.rank - b.rank)
    .filter((item, index, all) => item.rank === index + 1 && all.findIndex((other) => other.article_id === item.article_id) === index);

  await supabaseRest("article?is_top10=eq.true", { method: "PATCH", body: { is_top10: false, top10_rank: null, updated_at: new Date().toISOString() } });
  for (const item of selected) {
    await supabaseRest(`article?id=eq.${encodeURIComponent(item.article_id)}`, { method: "PATCH", body: { is_top10: true, top10_rank: item.rank, updated_at: new Date().toISOString() } });
  }
  const reportDate = koreaDate();
  await supabaseRest("daily_report?on_conflict=report_date", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { report_date: reportDate, summary_ko: result.summary_ko, model_name: llmConfig()?.model || null, generated_at: new Date().toISOString(), status: "published" }
  });
  return { status: "published", report_date: reportDate, top10_count: selected.length, selection: selected };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  try { return response.status(200).json(await generateDailyReport()); }
  catch (error) { return response.status(502).json({ status: "generation_failed", message: error.message }); }
}
