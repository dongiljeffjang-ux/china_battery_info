import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { embedDailyReport } from "../lib/vector-ingestion.js";
import { normalizeReportSections } from '../lib/report-classification.js';


function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

// Daily 요약은 밸류체인 카테고리별 개조식으로 만든다. prd.md F3의 "산업 전체와
// 셀/양극재/음극재별 핵심 이벤트" 요구를 그대로 따른다.
const SUMMARY_CATEGORIES = ["셀", "양극재", "음극재", "정책·공급망"];
export const DAILY_REPORT_PROMPT = "당신은 중국 이차전지 산업 데일리 편집자다. 제공된 본문 검증 완료 기사 요약만 근거로 중요도를 선별한다. 10개 이하를 선택한다. 단일 제3자 언론 보도만으로 확정할 수 없는 주장은 고르지 않는다. 회사의 직접 발표·공시 또는 복수 보도로 확인된 사업·기술·생산·고객·재무 변화를 우선한다. 사용자 피드백은 편집 선호의 보조 신호로만 사용하며, 사실성·출처 검증·중요도보다 우선하지 않는다. sections는 셀·양극재·음극재·정책·공급망별 개조식 사실 요약이다. sections에 산업 총평이나 해석을 만들지 않는다. 근거 기사가 있는 카테고리만 만들고 없는 카테고리는 넣지 않는다. subject_ko에는 회사명이나 주체를 쓴다. 같은 주체의 사실은 절대 여러 항목으로 나누지 말고 반드시 하나의 항목으로 합쳐 fact_ko 안에서 이어 쓴다. fact_ko는 실적·출하·증설·기술 순으로 묶고 수치는 쉼표로 이어 쓰며, 필요하면 두 문장까지 쓴다(예: '26년 상반기 음극재 출하 22.99만 톤(+46.4%), 매출 52.1억 위안(+44%), 순이익 1.47억 위안(-46%). 윈난 2기·쓰촨 루저우·오만 프로젝트 건설 추진'). 주체명을 fact_ko 안에서 되풀이하지 않는다. 수식어와 군더더기를 쓰지 않는다. 사실만 쓰고 전망·인과·투자 의견은 쓰지 않는다. selection_reason_ko는 선택된 원문의 확인 가능한 변화만 설명한다. insight는 사실이 아니라 해석이며 sections와 목적이 다르다. 한국 배터리 셀사·양극재·음극재 소재사의 임원이자 시장 애널리스트의 눈으로, 오늘 수집된 사실들이 경쟁 구도·수요 구조·원가와 기술 흐름·공급망 위치에서 무엇을 뜻하는지 해석한다. headline_ko는 여러 회사의 사실을 연결하거나 대조해 오늘 산업의 공통 흐름과 변곡점을 두세 문장으로 종합한다. 단일 회사의 실적을 그대로 나열하지 않는다. points의 point_ko는 그 흐름의 사업적 의미를 두세 문장의 줄글로 쓴다. 사실을 되풀이하는 요약을 쓰지 않는다. '확인해야 한다', '점검이 필요하다', '대응해야 한다' 같은 행동 지시나 할 일 목록을 쓰지 않는다. 판단과 함의만 쓴다. basis_ko에는 그 판단의 근거가 된 오늘의 사실을 회사명과 수치로 한 문장에 담는다. 근거가 오늘 수집분에 없으면 그 항목을 만들지 않는다. points는 서로 다른 주제를 다루며 세 개를 넘기지 않는다. 오늘의 사실만으로 설명이 되는 범위 안에서만 추론한다. 근거에서 한 단계 정도 나아간 함의는 괜찮지만, 여러 단계를 건너뛰거나 오늘 근거로 설명할 수 없는 결론은 쓰지 않는다. 단정하기 어려운 대목은 가능성으로 표현하고 단정형을 쓰지 않는다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다.";

// 화면은 산업총평+사실, 한국 소재사 insight의 두 묶음으로 나뉜다. 사실과 해석의 저장 컬럼은
// 계속 분리하되, 산업총평은 Daily 본문 안에서 사실 목록의 앞에 표시한다.
export const DAILY_REPORT_STRUCTURE_INSTRUCTION = "출력 구조를 엄격히 지킨다. insight.headline_ko는 '산업 총평'이다. 여러 회사·분야의 오늘 사실을 연결한 산업 차원의 해석만 두세 문장으로 쓴다. insight.points는 '한국 소재사 insight'다. 한국의 양극재·음극재 소재사에 직접 관련되는 경쟁 구도, 수요 구조, 원가·기술 흐름, 공급망 위치의 함의만 쓴다. 한국 셀사 일반론이나 소재사와 무관한 해석은 넣지 않는다. 오늘의 근거만으로 소재사 관점의 해석을 만들 수 없으면 points는 빈 배열로 둔다. sections는 '사실들'이며 산업 총평이나 해석을 절대 넣지 않는다.";

// daily_report.summary_ko는 text 컬럼이라 "## 카테고리 / - 항목" 형식으로 직렬화한다.
// 화면이 이 형식을 파싱하고, 형식이 없는 예전 리포트도 그대로 표시된다.
function serializeSections(sections = []) {
  return normalizeReportSections(sections)
    .filter((section) => section.points?.length)
    .sort((a, b) => SUMMARY_CATEGORIES.indexOf(a.category) - SUMMARY_CATEGORIES.indexOf(b.category))
    .map((section) => [`## ${section.category}`, ...section.points.map((point) => `- ${point.subject_ko} — ${point.fact_ko}`)].join("\n"))
    .join("\n");
}

// 해석은 사실과 분리해 저장한다. 화면도 두 영역을 나눠 표시한다.
function serializeInsight(insight) {
  if (!insight?.headline_ko && !insight?.points?.length) return null;
  const lines = [];
  if (insight.headline_ko) lines.push(`## 산업 총평\n- ${insight.headline_ko}`);
  // 판단과 근거를 각각 한 줄씩 끊어 두면 화면이 조각나 보인다. 한 항목으로 잇는다.
  if (insight.points?.length) lines.push(`## 한국 소재사 insight\n${insight.points.map((item) => `- [${item.segment}] ${item.point_ko} 근거: ${item.basis_ko}`).join("\n")}`);
  return lines.join("\n");
}

// Daily는 하루 전체를 엮는 가장 무거운 JSON 요청이다. 일반 LLM 기본값(45초)은
// 운영에서 실제로 부족했던 만큼 Daily에만 90초를 별도 배정한다.
export const DAILY_LLM_TIMEOUT_MS = 90000;

async function selectTop10(candidates, preferenceExamples = []) {
  const schema = {
    type: "object", additionalProperties: false, required: ["sections", "insight", "top10"],
    properties: {
      sections: { type: "array", minItems: 1, maxItems: 4, items: {
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
        required: ["headline_ko", "points"],
        properties: {
          headline_ko: { type: "string" },
          points: {
            type: "array", minItems: 0, maxItems: 3,
            items: {
              type: "object", additionalProperties: false,
              required: ["point_ko", "basis_ko", "segment"],
              properties: {
                point_ko: { type: "string" },
                basis_ko: { type: "string" },
                segment: { type: "string", enum: ["셀", "양극재", "음극재", "공급망", "전반"] }
              }
            }
          }
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
    provider: "openai_report",
    name: "daily_top10", schema,
    instructions: `${DAILY_REPORT_PROMPT} ${DAILY_REPORT_STRUCTURE_INSTRUCTION}`,
    input: JSON.stringify({ candidates: evidence, preference_examples: preferenceExamples }),
    timeoutMs: DAILY_LLM_TIMEOUT_MS,
  });
  return data;
}

const CANDIDATE_SELECT = "id,title_ko,summary_ko,source_name,published_at,article_company(company(name_ko))";
// Daily Top 10을 채우는 데 필요한 후보 수. 그날 수집분이 이보다 적으면 전날까지 넓힌다.
const TOP10_TARGET = 10;

// 리포트 날짜(한국시간) 하루의 시작·끝. Daily는 그날 뉴스만 싣는다.
function koreaDayBounds(reportDate) {
  const start = new Date(`${reportDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function generateDailyReport(articleIds = []) {
  // Top 10 후보는 리포트 날짜 하루치로 끊는다. 예전에는 최근 3일을 후보로 둬서 어제·그제
  // 기사가 오늘 리포트 상위를 차지했다. Daily는 그날 무슨 일이 있었는지를 담는 자리다.
  // 다만 이번 회차에 막 처리한 기사는 발행일과 무관하게 합쳐, 방금 읽은 것이 빠지지 않게 한다.
  const reportDate = koreaDate();
  const { start, end } = koreaDayBounds(reportDate);
  const fetchWindow = (from) => supabaseRest(`article?select=${CANDIDATE_SELECT}&verification_status=eq.pending_review&published_at=gte.${from}&published_at=lt.${end}&order=published_at.desc&limit=80`);
  const justProcessed = articleIds.length
    ? await supabaseRest(`article?select=${CANDIDATE_SELECT}&verification_status=eq.pending_review&id=in.(${articleIds.join(",")})`)
    : [];
  const merge = (rows) => [...new Map([...justProcessed, ...rows].map((article) => [article.id, article])).values()];
  let candidates = merge(await fetchWindow(start));
  // 그날 수집분만으로 Top 10을 채울 수 없다고 판단되면 전날까지 넓혀 후보를 다시 모은다.
  let windowDays = 1;
  if (candidates.length < TOP10_TARGET) {
    candidates = merge(await fetchWindow(new Date(new Date(start).getTime() - 86400000).toISOString()));
    windowDays = 2;
  }
  if (!candidates.length) return { status: "no_reviewed_articles" };
  if (windowDays > 1) console.info("[DAILY_WINDOW_WIDENED]", JSON.stringify({ reportDate, candidates: candidates.length }));
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
  return { status: "published", report_date: reportDate, window_days: windowDays, top10_count: selected.length, insight: Boolean(insightKo), embedded, selection: selected };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  try { return response.status(200).json(await generateDailyReport()); }
  catch (error) { return response.status(502).json({ status: "generation_failed", message: error.message }); }
  // 서버리스 함수는 응답 직후 종료돼 배경 전송이 유실된다. 끝나기 전에 반드시 보낸다.
  finally { await flushTraces(); }
}
