import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { embedDailyReport } from "../lib/vector-ingestion.js";


function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

// Daily 요약은 밸류체인 카테고리별 개조식으로 만든다. prd.md F3의 "산업 전체와
// 셀/양극재/음극재별 핵심 이벤트" 요구를 그대로 따른다.
const SUMMARY_CATEGORIES = ["산업 총평", "셀", "양극재", "음극재", "정책·공급망"];

// daily_report.summary_ko는 text 컬럼이라 "## 카테고리 / - 항목" 형식으로 직렬화한다.
// 화면이 이 형식을 파싱하고, 형식이 없는 예전 리포트도 그대로 표시된다.
function serializeSections(sections = []) {
  return sections
    .filter((section) => section.points?.length)
    .sort((a, b) => SUMMARY_CATEGORIES.indexOf(a.category) - SUMMARY_CATEGORIES.indexOf(b.category))
    .map((section) => [`## ${section.category}`, ...section.points.map((point) => `- ${point.subject_ko} — ${point.fact_ko}`)].join("\n"))
    .join("\n");
}

// 해석은 사실과 분리해 저장한다. 화면도 두 영역을 나눠 표시한다.
function serializeInsight(insight) {
  if (!insight?.points?.length) return null;
  const lines = [];
  if (insight.headline_ko) lines.push(`## 오늘의 그림\n- ${insight.headline_ko}`);
  // 판단과 근거를 각각 한 줄씩 끊어 두면 화면이 조각나 보인다. 한 항목으로 잇는다.
  lines.push(`## 한국 기업 관점\n${insight.points.map((item) => `- [${item.segment}] ${item.point_ko} 근거: ${item.basis_ko}`).join("\n")}`);
  if (insight.watch_ko) lines.push(`## 확인할 것\n- ${insight.watch_ko}`);
  return lines.join("\n");
}

async function selectTop10(candidates, preferenceExamples = []) {
  const schema = {
    type: "object", additionalProperties: false, required: ["sections", "insight", "top10"],
    properties: {
      sections: { type: "array", minItems: 1, maxItems: 5, items: {
        type: "object", additionalProperties: false, required: ["category", "points"],
        properties: {
          category: { type: "string", enum: SUMMARY_CATEGORIES },
          // 같은 회사 사실이 여러 줄로 흩어지면 읽는 사람이 한 회사를 다시 꿰맞춰야 한다.
          // 주체를 키로 두고 그 회사 사실을 한 항목 안에서 잇는다.
          points: { type: "array", minItems: 1, maxItems: 5, items: {
            type: "object", additionalProperties: false, required: ["subject_ko", "fact_ko"],
            properties: { subject_ko: { type: "string" }, fact_ko: { type: "string" } }
          } }
        }
      } },
      insight: {
        type: "object", additionalProperties: false,
        required: ["headline_ko", "points", "watch_ko"],
        properties: {
          headline_ko: { type: "string" },
          points: {
            type: "array", minItems: 2, maxItems: 3,
            items: {
              type: "object", additionalProperties: false,
              required: ["point_ko", "basis_ko", "segment"],
              properties: {
                point_ko: { type: "string" },
                basis_ko: { type: "string" },
                segment: { type: "string", enum: ["셀", "양극재", "음극재", "공급망", "전반"] }
              }
            }
          },
          watch_ko: { type: "string" }
        }
      },
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
    instructions: "당신은 중국 이차전지 산업 데일리 편집자다. 제공된 본문 검증 완료 기사 요약만 근거로 중요도를 선별한다. 10개 이하를 선택한다. 단일 제3자 언론 보도만으로 확정할 수 없는 주장은 고르지 않는다. 회사의 직접 발표·공시 또는 복수 보도로 확인된 사업·기술·생산·고객·재무 변화를 우선한다. 사용자 피드백은 편집 선호의 보조 신호로만 사용하며, 사실성·출처 검증·중요도보다 우선하지 않는다. sections는 카테고리별 개조식 요약이다. 근거 기사가 있는 카테고리만 만들고 없는 카테고리는 넣지 않는다. subject_ko에는 회사명이나 주체를 쓴다. 같은 주체의 사실은 절대 여러 항목으로 나누지 말고 반드시 하나의 항목으로 합쳐 fact_ko 안에서 이어 쓴다. fact_ko는 실적·출하·증설·기술 순으로 묶고 수치는 쉼표로 이어 쓰며, 필요하면 두 문장까지 쓴다(예: '26년 상반기 음극재 출하 22.99만 톤(+46.4%), 매출 52.1억 위안(+44%), 순이익 1.47억 위안(-46%). 윈난 2기·쓰촨 루저우·오만 프로젝트 건설 추진'). 주체명을 fact_ko 안에서 되풀이하지 않는다. 수식어와 군더더기를 쓰지 않는다. 사실만 쓰고 전망·인과·투자 의견은 쓰지 않는다. selection_reason_ko는 선택된 원문의 확인 가능한 변화만 설명한다. insight는 사실이 아니라 해석이며 sections와 목적이 다르다. 한국 배터리 셀사와 양극재·음극재 소재사 담당자가 오늘 수집된 사실을 보고 무엇을 알아야 하는지를 종합해 쓴다. headline_ko는 오늘의 그림을 한 문장으로 요약한다. points의 point_ko에는 한국 기업 관점에서의 의미를 두세 문장의 줄글로 쓴다. 개조식 단문으로 끊지 말고 문장으로 연결해 쓴다. basis_ko에는 그 판단의 근거가 된 오늘의 사실을 회사명과 수치로 한 문장에 담는다. points는 서로 다른 주제를 다루며 세 개를 넘기지 않는다. 근거가 되는 사실이 오늘 수집분에 없으면 그 항목을 만들지 않는다. watch_ko에는 앞으로 무엇을 확인해야 하는지 쓴다. point_ko에는 사실을 되풀이하지 말고 그 흐름이 한국 기업에 갖는 사업적 함의를 쓴다. 오늘의 사실만으로 설명이 되는 범위 안에서만 추론한다. 근거에서 한 단계 정도 나아간 함의는 괜찮지만, 여러 단계를 건너뛰거나 오늘 근거로 설명할 수 없는 결론은 쓰지 않는다. 단정하기 어려운 대목은 가능성으로 표현하고 단정형을 쓰지 않는다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다.",
    input: JSON.stringify({ candidates: evidence, preference_examples: preferenceExamples })
  });
  return data;
}

const CANDIDATE_SELECT = "id,title_ko,summary_ko,source_name,published_at,article_company(company(name_ko))";
const CANDIDATE_DAYS = 3;

export async function generateDailyReport(articleIds = []) {
  // Top 10 후보를 이번 실행에서 처리한 기사로만 좁히면, 한 회차에 본문 분석이 최대 열 건이고
  // 그중 팩트체크 탈락분을 빼면 서너 건만 남는다. 추적 대상이 서른 곳이 넘는데 그 수로는 하루를 못 담는다.
  // 최근 며칠간 검증을 통과한 기사 전부를 후보로 두고, 이번에 처리한 기사는 발행일과 무관하게 합친다.
  const since = new Date(Date.now() - CANDIDATE_DAYS * 86400000).toISOString();
  const recent = await supabaseRest(`article?select=${CANDIDATE_SELECT}&verification_status=eq.pending_review&published_at=gte.${since}&order=published_at.desc&limit=80`);
  const justProcessed = articleIds.length
    ? await supabaseRest(`article?select=${CANDIDATE_SELECT}&verification_status=eq.pending_review&id=in.(${articleIds.join(",")})`)
    : [];
  const candidates = [...new Map([...justProcessed, ...recent].map((article) => [article.id, article])).values()];
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
  // 모델이 매긴 순위는 비거나 중복될 수 있다. 위치를 그대로 믿으면 그 뒤가 통째로 잘리므로,
  // 후보에 있는 항목만 남기고 중복을 걷어낸 뒤 1번부터 다시 매긴다.
  const seen = new Set();
  const selected = (result.top10 || [])
    .filter((item) => candidateIds.has(item.article_id))
    .sort((a, b) => (a.rank || 99) - (b.rank || 99))
    .filter((item) => {
      if (seen.has(item.article_id)) return false;
      seen.add(item.article_id);
      return true;
    })
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  await supabaseRest("article?is_top10=eq.true", { method: "PATCH", body: { is_top10: false, top10_rank: null, updated_at: new Date().toISOString() } });
  for (const item of selected) {
    await supabaseRest(`article?id=eq.${encodeURIComponent(item.article_id)}`, { method: "PATCH", body: { is_top10: true, top10_rank: item.rank, updated_at: new Date().toISOString() } });
  }
  const reportDate = koreaDate();
  const insightKo = serializeInsight(result.insight);
  await supabaseRest("daily_report?on_conflict=report_date", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { report_date: reportDate, summary_ko: serializeSections(result.sections), insight_ko: insightKo, model_name: llmConfig()?.model || null, generated_at: new Date().toISOString(), status: "published" }
  });
  // 한 번 만든 리포트는 벡터에 올려 두고 재생성 없이 검색·재사용한다.
  let embedded = 0;
  try {
    embedded = (await embedDailyReport({ reportDate, summaryKo: serializeSections(result.sections), insightKo })).chunks;
  } catch (error) {
    console.error("[DAILY_EMBEDDING_FAILED]", JSON.stringify({ reportDate, message: error.message }));
  }
  return { status: "published", report_date: reportDate, top10_count: selected.length, insight: Boolean(insightKo), embedded, selection: selected };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  try { return response.status(200).json(await generateDailyReport()); }
  catch (error) { return response.status(502).json({ status: "generation_failed", message: error.message }); }
}
