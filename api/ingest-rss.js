import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { requireAccess } from "../lib/access.js";
import { processPendingArticle, recordProcessing } from "./process-article.js";
import { generateDailyReport } from "./generate-daily.js";
import { waitUntil } from "@vercel/functions";
import { runCurationHop, runReportRenewal } from "../lib/curation.js";
import { COMPANIES, POLICY_COMPANY, POLICY_COMPANY_ID, companiesFor, discoverChinaSources, discoveredVia, discoveryStats, plannedSearchRequests, trackedCompanies } from "../lib/china-sources.js";
import { logPipeline } from "../lib/pipeline-log.js";
import { llmConfig, createJsonResponse } from "../lib/llm-provider.js";
import { retryOnceOnTimeout } from "../lib/timeout-retry.js";
import { backfillCompanyEvents, digestReport, redateReportEvents } from "../lib/event-backfill.js";
import { ARTICLE_BODY_LABELS, buildArticleChunkTexts, embedEvents, splitArticleChunkText } from "../lib/vector-ingestion.js";
import crypto from "node:crypto";
import { extractMetricsFromEvents } from "../lib/report-metrics.js";
import { fetchCompanyFinancials, securityCodeOf } from "../lib/market-financials.js";
import { fetchPeriodRates } from "../lib/fx-rates.js";
import { acquireRun, releaseRun, claimStage, withSearchBudget, searchBudgetFor } from '../lib/ingestion-guard.js';

// Vercel Fluid compute(2025-04 이후 새 프로젝트 기본)에서 Hobby 함수 한도는 기본·최대 300초다.
// `api/*.js` Node 함수는 `export const config = { maxDuration }` 형식만 읽는다. 예전의
// `export const maxDuration = 60`은 무시돼 실제로는 300초가 적용돼 왔고, 그래서 78~110초짜리 유지 훅이
// 죽지 않고 로그까지 남길 수 있었다. 뜻을 분명히 하려고 올바른 형식으로 명시한다.
export const config = { maxDuration: 300 };

const TOP10_LIMIT = 10;
// 검증 기사가 0건인 핵심 비상장사. 연결 기사가 하나라도 생기면 그 회사는 다음 실행부터 빠진다
// (bootstrapCompanyIds 계산이 매 실행 다시 확인한다). docs/HANDOFF-CODEX.md 2026-09-07 절 참고.
const BOOTSTRAP_CANDIDATE_IDS = ["reshine", "kaijin-new-energy"];
// 한 회차에 실제 본문대조까지 보내는 bootstrap 기사 상한. 평상시 Top10 예산을 침해하지 않게 작게 둔다.
const BOOTSTRAP_PER_RUN = 2;
// 본문 분석 후보로 볼 기간. 수집이 최근 3일치를 훑으므로 같은 창으로 맞춘다.
const PROCESS_WINDOW_DAYS = 3;
// 거래소 공시는 뉴스와 시의성이 다르다. 3일 창으로 끊으니 8월에 모은 공시 257건이 창 밖으로
// 밀려 한 번도 분석되지 않았다. 공시는 창을 길게 주고, 뉴스 자리를 뺏지 않도록 몫을 따로 둔다.
const DISCLOSURE_WINDOW_DAYS = 45;
const DISCLOSURE_PER_RUN = 4;
// 훅마다 뉴스보다 먼저 처리할 공시 수. 야간 훅 2회면 하룻밤 4건이다.
const DISCLOSURE_FRONT_PER_HOP = 2;
const PROCESS_CONCURRENCY = 3;
// 본문 처리 훅 하나가 새 기사를 집는 시간. 진행 중인 기사는 이 시간이 지나도 마저 끝낸다.
const STAGE_BUDGET_MS = 60000;
// 유지 훅은 무거운 단계를 하나만 맡는다(lib/curation.js). 보고서 읽기의 LLM 호출 상한이 85초라
// 훅 예산은 그보다 조금 크게 둔다. 예전 45초는 "함수 한도 60초"를 전제로 한 값이었는데 그 전제가
// 틀렸고, 정상적으로 끝날 보고서 읽기·웹 백필을 35~45초에 중단해 timeout 실패를 만들고 있었다.
const CURATE_BUDGET_MS = 90000;
// 한 호출 안에서 훅을 몇 초까지 이어 돌릴지. 이 시간이 지나면 새 훅을 시작하지 않고 다음 호출로
// 넘긴다. 마지막 훅(최대 90초)과 로그·잔량 확인을 더해도 300초 한도 안에 든다.
const INVOCATION_BUDGET_MS = 170000;
// Vercel은 배포가 자기 자신을 이어 부르는 체인을 5번째 내부 호출에서 508 Loop Detected로 끊는다.
// 2026-09-06~07 운영 로그에서 서버 재귀 체인은 훅 소요와 무관하게 예외 없이 4훅에서 멈췄고,
// 크론 체인은 수집→본문×3→Daily로 깊이를 다 써 유지 단계가 한 번도 돌지 못했다.
// 그래서 훅은 한 호출 안에서 이어 돌리고, 호출을 넘길 때만 깊이를 하나 쓴다.
const MAX_CHAIN_DEPTH = 4;
// 다음 단계 호출을 넘기고 기다리는 최대 시간. 요청이 나갔는지만 확인하면 되므로 짧게 둔다.
const CHAIN_HANDOFF_MS = 1500;
// 한 번의 본문 처리 훅은 60초까지 걸린다. 2회를 넘기면 170초 호출 예산에 닿아 스스로를
// 다시 부를 수 있고, Daily → curate가 5번째 내부 호출이 되어 Vercel에 막힌다. 야간에도
// 여기서는 두 번만 처리하고 Daily와 유지 훅에 체인 깊이를 남긴다.
const MAX_PROCESS_HOPS = 2;
// 화면 버튼으로 도는 실행은 사용자가 결과를 보려고 누른 것이라 한 훅만 돌고 끝낸다.
// 상위 10건을 읽고 바로 Daily로 넘어가므로 1분 안팎에 끝난다.
const MANUAL_PROCESS_HOPS = 1;
// 유지 단계(보고서 읽기·시점 재확인·임베딩) 호출을 한 번의 실행에서 최대 몇 번 이어 붙일지.
// 회사 23곳 × 최근 3년 보고서 6건이면 백여 건이라, 처음 며칠은 한 실행에 수십 번 이어야 한다.
const MAX_CURATE_HOPS = 40;
// 한 훅 안에서 검색 1회 + 추출이 끝나야 하므로 회사당 건수를 낮춘다.
const BACKFILL_MAX_EVENTS = 12;
const BACKFILL_SINCE = "2023-01-01";
// 운영·디버그용 ?digest= 경로. 추출 단위를 쪼갠 뒤 건수가 늘어 유지 훅과 같은 상한을 쓴다.
const DIGEST_MAX_EVENTS = 30;
// 운영·디버그용 ?backfill=/?digest= 경로의 LLM 호출 상한. 유지 훅(lib/curation.js)은 이미
// WEB_LLM_TIMEOUT_MS(60초)·REPORT_LLM_TIMEOUT_MS(85초)로 고쳤지만, 이 관리자 수동 경로는
// timeoutMs를 넘기지 않아 기본값(웹 검색 35초, 그 밖 45초)에 걸려 있었다. 2026-09-07 밤
// Reshine·Kaijin 수동 백필이 이 기본값에 막혀 "aborted due to timeout"으로 실패했다.
// 함수 한도가 300초(export const config)이므로 넉넉히 준다.
const MANUAL_LLM_TIMEOUT_MS = 200000;
const HIGH_SIGNAL_TERMS = [
  "扩产", "增产", "产能", "投产", "开工", "项目", "签约", "订单", "定点", "认证", "量产", "出货", "交付",
  "营收", "收入", "净利润", "财报", "业绩", "海外", "建厂", "投资", "收购", "合作", "固态", "硅碳", "lmfp",
  "磷酸锰铁锂", "钠电", "专利", "标准", "回收", "capacity", "production", "order", "certification", "shipment",
  "revenue", "overseas", "investment", "acquisition", "solid-state", "silicon"
];
HIGH_SIGNAL_TERMS.push("政策", "法规", "条例", "公告", "补贴", "购置税", "消费税", "出口管制", "退税", "强制标准", "policy", "regulation", "subsidy", "tax", "export control");
const LOW_SIGNAL_TERMS = ["视频", "faq", "值不值", "广告", "车主", "落地价", "车型", "测评", "评测", "怎么买", "怎么选", "对比", "续航"];

function isCronRequest(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function normalizeHeadline(title = "") {
  return title.toLowerCase().replace(/\s+/g, " ").replace(/[\p{P}\p{S}]/gu, "").trim();
}

function safePublishedAt(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// 좋아요/싫어요를 다음 선별에 쓰기 위해 회사·매체 선호로 일반화한다.
//
// 투표는 기사 단위라 그 기사에만 붙는다. 아직 오지 않은 기사에 적용하려면 후보 단계에서 이미
// 알고 있는 속성으로 옮겨야 한다. 선별 시점에 가진 것은 원문 제목(중국어)·매체·회사·시각뿐이고,
// 제목은 언어가 달라 한국어 피드백과 맞출 수 없다. 그래서 회사와 매체 두 축만 쓴다.
const FEEDBACK_SAMPLE = 200;
// 피드백이 신호 단어 하나(+20)보다 세지 않게 상한을 둔다. 취향이 산업 신호를 덮으면 안 된다.
const FEEDBACK_VOTE_WEIGHT = 4;
const FEEDBACK_COMPANY_CAP = 12;
const FEEDBACK_SOURCE_CAP = 8;

const EMPTY_PREFERENCE = { company: new Map(), source: new Map() };

async function feedbackPreference() {
  try {
    const rows = await supabaseRest(`article_feedback?select=vote,article(source_name,article_company(company_id))&order=updated_at.desc&limit=${FEEDBACK_SAMPLE}`);
    const company = new Map();
    const source = new Map();
    for (const row of rows || []) {
      const vote = Number(row.vote) || 0;
      if (!vote || !row.article) continue;
      const sourceName = row.article.source_name;
      if (sourceName) source.set(sourceName, (source.get(sourceName) || 0) + vote);
      for (const link of row.article.article_company || []) {
        company.set(link.company_id, (company.get(link.company_id) || 0) + vote);
      }
    }
    return { company, source };
  } catch (error) {
    // 피드백을 못 읽어도 선별 자체는 돌아야 한다. 보조 신호가 없는 상태로 진행한다.
    console.error("[FEEDBACK_PREFERENCE_FAILED]", JSON.stringify({ message: error.message }));
    return EMPTY_PREFERENCE;
  }
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

function feedbackBonus(article, preference) {
  const companyVotes = (article.article_company || []).reduce((sum, link) => sum + (preference.company.get(link.company_id) || 0), 0);
  const sourceVotes = preference.source.get(article.source_name) || 0;
  return clamp(companyVotes * FEEDBACK_VOTE_WEIGHT, FEEDBACK_COMPANY_CAP)
    + clamp(sourceVotes * FEEDBACK_VOTE_WEIGHT, FEEDBACK_SOURCE_CAP);
}

function headlineScore(article, preference = EMPTY_PREFERENCE) {
  const title = (article.title_original || "").toLowerCase();
  const highSignals = HIGH_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const lowSignals = LOW_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const ageDays = Math.max(0, (Date.now() - new Date(article.published_at || Date.now()).getTime()) / 86400000);
  // 공시는 회사가 직접 낸 1차 출처라 제목에 신호 단어가 없어도 언론 기사보다 우선해 읽는다.
  const disclosureBonus = article.source_tier === "official_disclosure" ? 25 : 0;
  return (highSignals * 20) - (lowSignals * 45) + disclosureBonus + (article.article_company?.length ? 3 : 0)
    + feedbackBonus(article, preference) - Math.min(ageDays, 30) / 10;
}

// 연결 기사가 0건인 bootstrap 후보만 골라낸다. 읽기 전용 쿼리다. raw 기사(article_company 링크) 1건만
// 생겨도 그 회사는 빠지므로, 365일 단독 검색은 처음 한 번만 돌고 평상시 3일 수집으로 돌아간다.
async function bootstrapCompanyIds() {
  if (!BOOTSTRAP_CANDIDATE_IDS.length) return [];
  const ids = BOOTSTRAP_CANDIDATE_IDS.map((id) => `"${id}"`).join(",");
  const linked = await supabaseRest(`article_company?select=company_id&company_id=in.(${ids})&limit=1000`);
  const hasArticles = new Set((linked || []).map((row) => row.company_id));
  return BOOTSTRAP_CANDIDATE_IDS.filter((id) => !hasArticles.has(id));
}

async function selectHeadlineTop10(pilot = false) {
  // 본문을 못 가져온 기사는 다시 집어도 같은 결과다. 한 회차 본문 분석 예산이 열 건뿐이라
  // 죽은 URL이 그 자리를 계속 차지하면 새 기사가 밀린다. body_unavailable과 body_too_short는
  // URL 자체가 쓸모없다는 뜻이므로 제외하고, processing_failed는 일시적 오류일 수 있어 다시 시도한다.
  //
  // 후보는 최근 며칠치로 끊는다. 예전에는 미처리 기사 전체(수년치)를 놓고 점수를 매겨,
  // 신호 단어가 많은 옛 기사가 오늘 기사를 계속 밀어내고 재고만 쌓였다. Daily는 오늘 것을
  // 읽는 게 목적이므로, 그 창을 벗어난 기사는 다시 집지 않고 흘려보낸다.
  const select = "id,title_original,source_name,source_tier,published_at,article_company(company_id)";
  const filter = "verification_status=eq.pending&or=(processing_status.is.null,processing_status.eq.processing_failed)";
  const since = new Date(Date.now() - PROCESS_WINDOW_DAYS * 86400000).toISOString();
  const disclosureSince = new Date(Date.now() - DISCLOSURE_WINDOW_DAYS * 86400000).toISOString();
  // bootstrap 기사는 최대 365일 전 것이라 위 3일 창에 들지 않는다. 창 없이 별도로 뽑아,
  // 처음 한 번 확보한 과거 기사가 실제 본문대조까지 가도록 한다.
  const [rows, disclosureRows, bootstrapRows, preference] = await Promise.all([
    supabaseRest(`article?select=${select}&${filter}&published_at=gte.${since}&order=published_at.desc&limit=500`),
    supabaseRest(`article?select=${select}&${filter}&source_tier=eq.official_disclosure&published_at=gte.${disclosureSince}&order=published_at.desc&limit=300`),
    supabaseRest(`article?select=${select}&${filter}&source_tier=like.web_search_bootstrap_*&order=published_at.desc&limit=50`),
    feedbackPreference(),
  ]);
  const pick = (candidates, keep) => {
    const unique = new Map();
    for (const article of candidates) {
      if (pilot && !article.article_company?.some(link => ['catl','hunan-yuneng','btr'].includes(link.company_id))) continue;
      const key = normalizeHeadline(article.title_original);
      if (key && !unique.has(key)) unique.set(key, article);
    }
    return [...unique.values()]
      .filter(keep)
      .map((article) => ({ ...article, headline_score: headlineScore(article, preference) }))
      .sort((a, b) => b.headline_score - a.headline_score || new Date(b.published_at) - new Date(a.published_at));
  };
  // 뉴스는 최근 3일 창에서 Top 10. 공시는 45일 창에서 별도 몫으로 뽑아 밀린 재고를 조금씩 소화한다.
  const news = pick(rows || [], (article) =>
    article.source_tier !== "official_disclosure"
    && !article.article_company?.some(link => link.company_id === POLICY_COMPANY_ID)
    && (article.source_tier.startsWith("web_search_") || article.source_name === "CATL Newsroom")
  ).slice(0, TOP10_LIMIT);
  const disclosures = pick(disclosureRows || [], () => true).slice(0, DISCLOSURE_PER_RUN);
  const bootstrap = pick(bootstrapRows || [], () => true).slice(0, BOOTSTRAP_PER_RUN);
  const policies = pick(rows || [], article => article.article_company?.some(link => link.company_id === POLICY_COMPANY_ID)).slice(0, 4);
  // 최근에 발견된 bootstrap 기사는 news 창(3일)에도 걸릴 수 있다. 같은 기사를 두 번 처리하지 않는다.
  // 공시 일부를 맨 앞에 둔다. 처리는 이 순서대로 시간 예산이 닿는 데까지 가고 훅마다 선별을 다시 하는데,
  // 뉴스는 매번 새로 10칸을 채운다. 공시를 뒤에 두면 11~14번째에서 한 번도 차례가 오지 않았다
  // (2026-09-08~09-10 pipeline_log: 모든 훅이 공시 4건을 골랐지만 처리 0건, 야간 훅 상한 2회).
  const combined = new Map();
  const front = disclosures.slice(0, DISCLOSURE_FRONT_PER_HOP);
  for (const article of [...front, ...policies, ...news, ...disclosures.slice(DISCLOSURE_FRONT_PER_HOP), ...bootstrap]) combined.set(article.id, article);
  return [...combined.values()];
}

async function processSelectedBatch(rows, deadline = Infinity) {
  const outcomes = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROCESS_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      // 예산이 다하면 남은 기사는 다음 호출이 이어받는다. 기사 하나를 반쯤 처리하다 잘리는 것보다 낫다.
      if (Date.now() > deadline) break;
      const article = rows[next++];
      const companyId = article.article_company?.some(link => link.company_id === POLICY_COMPANY_ID) ? POLICY_COMPANY_ID : article.article_company?.[0]?.company_id;
      if (!companyId) continue;
      try {
        outcomes.push({ articleId: article.id, ...(await processPendingArticle(article.id, companyId)) });
      } catch (error) {
        console.error("[ARTICLE_PROCESS_FAILED]", JSON.stringify({ articleId: article.id, source: article.source_name, message: error.message }));
        await recordProcessing(article.id, "processing_failed", error.message);
        outcomes.push({ articleId: article.id, status: "processing_failed", message: error.message });
      }
    }
  }));
  return outcomes;
}

// 과거 시계열 백필. 회사 1곳씩 호출한다.
// 파이프라인 이벤트와 달리 article_id가 없고 timeline_eligibility가 reference라 구분된다.
async function runBackfill(response, companyId, sinceParam, mode) {
  const company = COMPANIES.find((item) => item.id === companyId);
  if (!company) return response.status(404).json({ status: "unknown_company", company_id: companyId });
  if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam || "") ? sinceParam : BACKFILL_SINCE;
  const until = new Date().toISOString().slice(0, 10);
  try {
    const digest = mode === "annual" || mode === "semiannual" || mode === "quarterly";
    const { rows, dropped, returned, provider, report } = digest
      ? await digestReport({ company, kind: mode, maxEvents: DIGEST_MAX_EVENTS, timeoutMs: MANUAL_LLM_TIMEOUT_MS })
      : await backfillCompanyEvents({ company, since, until, maxEvents: BACKFILL_MAX_EVENTS, timeoutMs: MANUAL_LLM_TIMEOUT_MS });
    const existing = await supabaseRest(`event?select=occurred_at,title_ko&company_id=eq.${encodeURIComponent(companyId)}`);
    const eventKey = (row) => JSON.stringify([row.occurred_at, row.title_ko]);
    const seen = new Set(existing.map(eventKey));
    const fresh = rows.filter((row) => !seen.has(eventKey(row)));
    // 적재와 동시에 벡터 검색 대상으로 만든다. 회사별 시계열을 나중에 검색·연관 분석에 쓰려면 필수다.
    let embedded = 0;
    if (fresh.length) {
      const stored = await supabaseRest("event", { method: "POST", prefer: "return=representation", body: fresh });
      try {
        embedded = (await embedEvents((stored || []).map((row) => ({ ...row, company_name_ko: company.name_ko })))).chunks;
      } catch (error) {
        console.error("[EVENT_EMBEDDING_FAILED]", JSON.stringify({ companyId, message: error.message }));
      }
    }
    console.info("[BACKFILL_DONE]", JSON.stringify({ companyId, mode, returned, kept: rows.length, inserted: fresh.length, dropped }));
    return response.status(200).json({ status: "ok", mode, company_id: companyId, company_name: company.name_ko, since, until, report: report || null, returned, kept: rows.length, inserted: fresh.length, embedded, duplicates: rows.length - fresh.length, dropped, provider });
  } catch (error) {
    console.error("[BACKFILL_FAILED]", JSON.stringify({ companyId, mode, message: error.message }));
    return response.status(502).json({ status: "backfill_failed", mode, company_id: companyId, message: error.message });
  }
}

// 기사 청크를 현행 형식으로 다시 만든다. 예전에는 긴 기사 본문 조각마다 같은 요약을 복사해
// 검색 결과를 독점했다. 새 형식은 요약을 첫 조각에만 두고, 나머지는 제목과 본문만 넣는다.
//
// ?article_chunks=1은 읽기 전용 미리보기, ?article_chunks=write&limit=5는 최대 5기사 적용이다.
// Vercel의 운영 OpenAI 키로 임베딩하므로 로컬 .env.local이 없어도 된다. 기사를 하나씩 처리해
// 새 행 upsert가 성공한 기사만 옛 조각을 지운다.
const ARTICLE_CHUNK_SELECT = "id,article_id,company_id,source_url,source_name,published_at,content_ko,content_original,chunk_index";
const ARTICLE_CHUNK_PAGE = 500;
const ARTICLE_CHUNK_DEFAULT_LIMIT = 5;

async function articleChunkPlans() {
  const chunks = [];
  for (let offset = 0; ; offset += ARTICLE_CHUNK_PAGE) {
    const page = await supabaseRest(`knowledge_chunk?select=${ARTICLE_CHUNK_SELECT}&source_type=eq.article_chunk&order=article_id.asc,chunk_index.asc&limit=${ARTICLE_CHUNK_PAGE}&offset=${offset}`);
    chunks.push(...(page || []));
    if (!page || page.length < ARTICLE_CHUNK_PAGE) break;
  }
  const byArticle = new Map();
  for (const row of chunks) {
    if (!row.article_id) continue;
    if (!byArticle.has(row.article_id)) byArticle.set(row.article_id, []);
    byArticle.get(row.article_id).push(row);
  }
  const plans = [];
  let alreadyNew = 0;
  for (const [articleId, rows] of byArticle) {
    rows.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
    const parsed = rows.map((row) => ({ row, ...splitArticleChunkText(row.content_ko) }));
    if (parsed.every((item) => !item.summary || !item.body)) { alreadyNew += 1; continue; }
    const withSummary = parsed.find((item) => item.summary);
    const title = withSummary?.title || parsed[0]?.title || "";
    const summary = withSummary?.summary || "";
    const bodyLabel = parsed.find((item) => item.bodyLabel)?.bodyLabel || ARTICLE_BODY_LABELS.original;
    const bodyChunks = parsed.filter((item) => item.body).map((item) => item.body);
    const texts = buildArticleChunkTexts({ titleKo: title, summaryKo: summary, bodyChunks, bodyLabel });
    if (!texts.length) continue;
    const sample = rows[0];
    plans.push({
      articleId, texts, before: rows.length,
      originals: parsed.filter((item) => item.body).map((item) => item.row.content_original || null),
      summaryFirst: texts.length === bodyChunks.length + 1,
      meta: { company_id: sample.company_id, source_url: sample.source_url, source_name: sample.source_name, published_at: sample.published_at },
    });
  }
  return { chunks: chunks.length, articles: byArticle.size, alreadyNew, plans };
}

async function embedArticleChunks(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", input: texts, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
  const payload = await response.json();
  const embeddings = (payload.data || []).map((item) => item.embedding);
  if (embeddings.length !== texts.length) throw new Error("EMBEDDING_COUNT_MISMATCH");
  return { model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", embeddings };
}

async function runArticleChunkRestructure(response, write, requestedLimit) {
  try {
    const { chunks, articles, alreadyNew, plans } = await articleChunkPlans();
    const summary = {
      article_chunks: chunks, articles, already_new_articles: alreadyNew, pending_articles: plans.length,
      pending_chunks_before: plans.reduce((sum, plan) => sum + plan.before, 0),
      pending_chunks_after: plans.reduce((sum, plan) => sum + plan.texts.length, 0),
      sample: plans.slice(0, 2).map((plan) => ({ article_id: plan.articleId, chunks_before: plan.before, chunks_after: plan.texts.length, preview: plan.texts.slice(0, 2).map((text) => text.replace(/\s+/g, " ").slice(0, 160)) })),
    };
    if (!write) return response.status(200).json({ status: "preview", note: "DB에 쓰지 않았습니다. 실제로 바꾸려면 ?article_chunks=write&limit=5", ...summary });
    const limit = Math.min(20, Math.max(1, Number(requestedLimit) || ARTICLE_CHUNK_DEFAULT_LIMIT));
    const results = [];
    for (const plan of plans.slice(0, limit)) {
      try {
        const { model, embeddings } = await embedArticleChunks(plan.texts);
        const rows = plan.texts.map((content, index) => ({
          company_id: plan.meta.company_id, article_id: plan.articleId, source_type: "article_chunk",
          source_url: plan.meta.source_url, source_name: plan.meta.source_name, published_at: plan.meta.published_at,
          content_ko: content, content_original: plan.summaryFirst && index === 0 ? null : plan.originals[plan.summaryFirst ? index - 1 : index] || null,
          chunk_index: index, chunk_total: plan.texts.length,
          content_hash: crypto.createHash("sha256").update(`${plan.articleId}:${index}:${content}`).digest("hex"),
          embedding: embeddings[index], embedding_model: model,
        }));
        await supabaseRest("knowledge_chunk?on_conflict=content_hash", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
        const existing = await supabaseRest(`knowledge_chunk?select=id,content_hash&source_type=eq.article_chunk&article_id=eq.${encodeURIComponent(plan.articleId)}`);
        const hashes = new Set(rows.map((row) => row.content_hash));
        const stale = (existing || []).filter((row) => !hashes.has(row.content_hash)).map((row) => row.id);
        for (const id of stale) await supabaseRest(`knowledge_chunk?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
        results.push({ article_id: plan.articleId, status: "ok", before: plan.before, after: rows.length, removed: stale.length });
      } catch (error) {
        console.error("[ARTICLE_CHUNK_RESTRUCTURE_FAILED]", JSON.stringify({ articleId: plan.articleId, message: error.message }));
        results.push({ article_id: plan.articleId, status: "failed", message: String(error.message || error).slice(0, 160) });
      }
    }
    const done = results.filter((item) => item.status === "ok");
    const failed = results.filter((item) => item.status === "failed");
    console.info("[ARTICLE_CHUNK_RESTRUCTURE_DONE]", JSON.stringify({ requested: limit, done: done.length, failed: failed.length }));
    return response.status(failed.length ? 502 : 200).json({ status: failed.length ? "partial" : "ok", requested: limit, completed: done.length, failed: failed.length, results, ...summary });
  } catch (error) {
    console.error("[ARTICLE_CHUNK_RESTRUCTURE_PREVIEW_FAILED]", JSON.stringify({ message: error.message }));
    return response.status(502).json({ status: "article_chunk_restructure_failed", message: String(error.message || error).slice(0, 400) });
  }
}

// 정기보고서 발췌 → report_metric. LLM을 쓰지 않으므로 과금이 없고, 여러 번 돌려도 같은 결과다.
//
// 로컬 스크립트(scripts/backfill-report-metrics.mjs)와 같은 일을 하지만 이 경로가 운영용이다.
// Vercel의 SUPABASE 키가 Sensitive라 로컬로 내려받을 수 없어(docs/HANDOFF-CODEX.md 8절),
// 운영 DB에 쓰는 일회성 작업은 관리자 로그인 브라우저에서 URL을 여는 방식이 유일한 경로다.
const METRIC_EVENT_SELECT = "id,company_id,evidence_kind,occurred_at,source_url,original_excerpt";
const METRIC_PAGE = 500;
async function runMetricBackfill(response, write) {
  try {
    const events = [];
    for (let offset = 0; ; offset += METRIC_PAGE) {
      const page = await supabaseRest(`event?select=${METRIC_EVENT_SELECT}&evidence_kind=in.(annual_report,periodic_report)&order=occurred_at.desc&limit=${METRIC_PAGE}&offset=${offset}`);
      events.push(...page);
      if (page.length < METRIC_PAGE) break;
    }
    const rows = extractMetricsFromEvents(events);
    const byMetric = {};
    for (const row of rows) byMetric[row.metric] = (byMetric[row.metric] || 0) + 1;
    // 매출 커버리지는 PRD 8절의 게이트가 보는 수치다. 응답에 그대로 실어 눈으로 확인하게 한다.
    const years = ["2023", "2024", "2025"];
    const revenueCells = new Set(rows.filter((row) => row.metric === "revenue_total" && years.includes(row.period)).map((row) => `${row.company_id} ${row.period}`));
    const companies = new Set(events.map((event) => event.company_id));
    const summary = {
      events: events.length, rows: rows.length, by_metric: byMetric,
      revenue_cells: revenueCells.size, cells_total: companies.size * years.length, companies: companies.size,
      sample: rows.slice(0, 8).map((row) => ({ company_id: row.company_id, period: row.period, metric: row.metric, value: row.value, line_item_zh: row.line_item_zh, quantity_text: row.quantity_text })),
    };
    if (!write) return response.status(200).json({ status: "preview", note: "DB에 쓰지 않았습니다. 실제로 채우려면 ?metrics=write", ...summary });
    const payload = rows.map((row) => ({
      company_id: row.company_id, period: row.period, metric: row.metric, value: row.value, unit: row.unit,
      currency: row.currency, line_item_zh: row.line_item_zh, quantity_text: row.quantity_text,
      yoy_pct_stated: row.yoy_pct_stated, excerpt: row.excerpt, event_id: row.event_id,
      report_kind: row.report_kind, source_url: row.source_url, occurred_at: row.occurred_at,
      extractor: "report-metrics/regex",
    }));
    for (let i = 0; i < payload.length; i += 200) {
      await supabaseRest("report_metric?on_conflict=company_id,period,metric", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: payload.slice(i, i + 200) });
    }
    console.info("[METRIC_BACKFILL_DONE]", JSON.stringify({ events: events.length, rows: rows.length, revenue_cells: revenueCells.size }));
    return response.status(200).json({ status: "ok", written: payload.length, ...summary });
  } catch (error) {
    console.error("[METRIC_BACKFILL_FAILED]", JSON.stringify({ write, message: error.message }));
    return response.status(502).json({ status: "metric_backfill_failed", message: String(error.message || error).slice(0, 400) });
  }
}

// 거래소 표준 손익 항목 적재. 회사당 요청 1회, LLM 0회.
//
// report_metric(보고서 발췌)과 나란히 둔다. 발췌 경로는 요약이 고른 항목만 있어 영업이익이
// 72 회사-연 중 3칸뿐이었다. 이 경로는 영업이익·扣非까지 분기 단위로 채우되 원문 발췌가 없다.
// 두 출처가 같은 칸을 채우면 서로 검증이 된다.
const FINANCIAL_GAP_MS = 400;
// 자동 갱신 주기. 중국 정기보고서는 4·8·10월에 몰려 나오므로 분기에 한 번이면 충분하지만,
// 한 번 실패하면 다음 분기까지 낡은 값을 보게 된다. 7일마다 확인해 그 사이 새 결산이 올라왔으면
// 채운다. 이 경로는 LLM을 쓰지 않아 반복 실행 비용이 사실상 없다.
const FINANCIAL_REFRESH_DAYS = 7;
const FINANCIAL_STAGE = "financials";

// 마지막 성공 이후 주기가 지났는지 본다. 기록을 못 읽으면 "돌 때가 됐다"로 본다 —
// 갱신을 건너뛰어 낡은 값을 보여 주는 쪽이 한 번 더 도는 것보다 나쁘다.
async function financialRefreshDue() {
  try {
    const rows = await supabaseRest(`pipeline_log?select=created_at,status&stage=eq.${FINANCIAL_STAGE}&status=eq.ok&order=created_at.desc&limit=1`);
    const last = rows?.[0]?.created_at;
    if (!last) return true;
    return Date.now() - new Date(last).getTime() > FINANCIAL_REFRESH_DAYS * 86400000;
  } catch {
    return true;
  }
}

// 크론이 부르는 자동 갱신. 실패해도 수집 파이프라인을 멈추지 않는다. 대신 실패를 로그에 남기고,
// 화면이 그 로그를 읽어 "재무 데이터가 최신이 아니다"라고 알린다.
async function refreshFinancialsIfDue({ force = false } = {}) {
  if (!force && !(await financialRefreshDue())) return { skipped: "not_due" };
  const started = Date.now();
  const targets = (await trackedCompanies()).filter((company) => securityCodeOf(company));
  const rows = [];
  const failed = [];
  for (const company of targets) {
    try {
      rows.push(...(await fetchCompanyFinancials(company)).rows);
    } catch (error) {
      failed.push({ company_id: company.id, message: String(error.message || error).slice(0, 120) });
    }
    await new Promise((resolve) => setTimeout(resolve, FINANCIAL_GAP_MS));
  }
  // 한 회사도 못 받았으면 쓰지 않는다. 부분 실패는 받은 만큼 채우고 실패 목록을 남긴다.
  if (!rows.length) {
    await logPipeline(FINANCIAL_STAGE, { companies: targets.length, rows: 0, failed }, { status: "failed", durationMs: Date.now() - started });
    return { status: "failed", failed };
  }
  let fxRows = [];
  try {
    fxRows = await fetchPeriodRates([...new Set(rows.map((row) => row.period))]);
  } catch (error) {
    failed.push({ company_id: "fx", message: String(error.message || error).slice(0, 120) });
  }
  try {
    for (let i = 0; i < rows.length; i += 300) {
      await supabaseRest("market_financial?on_conflict=company_id,period,metric", {
        method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: rows.slice(i, i + 300),
      });
    }
    if (fxRows.length) {
      await supabaseRest("fx_rate_period?on_conflict=period,base,quote", {
        method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: fxRows,
      });
    }
  } catch (error) {
    await logPipeline(FINANCIAL_STAGE, { companies: targets.length, rows: rows.length, write_error: String(error.message || error).slice(0, 200), failed }, { status: "failed", durationMs: Date.now() - started });
    return { status: "failed", message: error.message };
  }
  await logPipeline(FINANCIAL_STAGE, { companies: targets.length, rows: rows.length, fx_rows: fxRows.length, failed }, { status: failed.length ? "partial" : "ok", durationMs: Date.now() - started });
  return { status: failed.length ? "partial" : "ok", rows: rows.length, fx_rows: fxRows.length, failed };
}

async function runFinancialBackfill(response, write, only) {
  const targets = (await trackedCompanies()).filter((company) => securityCodeOf(company)).filter((company) => !only || company.id === only);
  if (!targets.length) return response.status(404).json({ status: "no_target_company", only });
  const rows = [];
  const failed = [];
  for (const company of targets) {
    try {
      const result = await fetchCompanyFinancials(company);
      rows.push(...result.rows);
    } catch (error) {
      failed.push({ company_id: company.id, message: String(error.message || error).slice(0, 120) });
    }
    // 남의 서버를 몰아치지 않는다. 26개사면 전체 10초 남짓이라 함수 예산 안이다.
    await new Promise((resolve) => setTimeout(resolve, FINANCIAL_GAP_MS));
  }
  const byMetric = {};
  for (const row of rows) byMetric[row.metric] = (byMetric[row.metric] || 0) + 1;
  const years = ["2023", "2024", "2025"];
  const cells = (metric) => new Set(rows.filter((row) => row.metric === metric && years.includes(row.period)).map((row) => `${row.company_id} ${row.period}`)).size;
  const summary = {
    companies: targets.length, rows: rows.length, by_metric: byMetric, failed,
    annual_cells: { revenue_total: cells("revenue_total"), operating_profit: cells("operating_profit"), net_profit_attr: cells("net_profit_attr") },
    cells_total: targets.length * years.length,
    sample: rows.filter((row) => row.metric === "operating_profit").slice(0, 6)
      .map((row) => ({ company_id: row.company_id, period: row.period, value: row.value, item_zh: row.item_zh, currency: row.currency })),
  };
  if (!write) return response.status(200).json({ status: "preview", note: "DB에 쓰지 않았습니다. 실제로 채우려면 ?financials=write", ...summary });
  for (let i = 0; i < rows.length; i += 300) {
    await supabaseRest("market_financial?on_conflict=company_id,period,metric", {
      method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: rows.slice(i, i + 300),
    });
  }
  console.info("[FINANCIAL_BACKFILL_DONE]", JSON.stringify({ companies: targets.length, rows: rows.length, failed: failed.length }));
  return response.status(200).json({ status: "ok", written: rows.length, ...summary });
}

// 기간별 평균 환율 적재. 외부 요청 1회, LLM 0회.
//
// 재무 표에 실제로 있는 기간만 만든다. 쓰지도 않을 기간의 환율을 미리 채우지 않는다.
async function runFxBackfill(response, write) {
  try {
    const periods = new Set();
    for (let offset = 0; ; offset += 1000) {
      const page = await supabaseRest(`market_financial?select=period&limit=1000&offset=${offset}`);
      for (const row of page) periods.add(row.period);
      if (page.length < 1000) break;
    }
    const wanted = [...periods].sort();
    const rows = await fetchPeriodRates(wanted);
    const summary = {
      periods_wanted: wanted.length, rows: rows.length,
      missing: wanted.filter((period) => !rows.some((row) => row.period === period)),
      sample: rows.slice(-6).map((row) => ({ period: row.period, rate_avg: Number(row.rate_avg.toFixed(4)), sample_days: row.sample_days })),
    };
    if (!write) return response.status(200).json({ status: "preview", note: "DB에 쓰지 않았습니다. 실제로 채우려면 ?fx=write", ...summary });
    for (let i = 0; i < rows.length; i += 300) {
      await supabaseRest("fx_rate_period?on_conflict=period,base,quote", {
        method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: rows.slice(i, i + 300),
      });
    }
    console.info("[FX_BACKFILL_DONE]", JSON.stringify({ rows: rows.length }));
    return response.status(200).json({ status: "ok", written: rows.length, ...summary });
  } catch (error) {
    console.error("[FX_BACKFILL_FAILED]", JSON.stringify({ message: error.message }));
    return response.status(502).json({ status: "fx_backfill_failed", message: String(error.message || error).slice(0, 400) });
  }
}

// 다음 단계를 같은 함수의 새 호출로 넘긴다.
//
// 수집·본문 처리·Daily 생성을 한 호출에 몰아 넣으면 60초에 잘려 Daily가 만들어지지 않았다.
// 각 단계를 별도 호출로 나누고, 앞 단계가 뒷 단계를 HTTP로 부른다. 부름을 받은 쪽은 202를 곧바로
// 돌려주고 waitUntil 안에서 일을 계속하므로, 부른 쪽이 그 호출을 await해도 수십 ms만 쓴다.
// 인증은 크론과 같은 CRON_SECRET을 쓴다. 비밀이 없으면 이어 붙이지 못하므로 그 사실을 남긴다.
// 유지 단계(공시 백필·보강·시점 재확인)는 LLM 호출이 많다. 화면 버튼으로 수집할 때마다 돌면
// 토큰이 과하게 나가므로, 야간 크론이 시작한 실행에서만 Daily 뒤에 이어 붙인다. 그 표시가 curate=1이다.
function wantsCurate(request) {
  return String(request.query?.curate || "") === "1";
}
// 깊게 도는 실행인지(야간 크론) 빠르게 끝내는 실행인지(화면 버튼) 구분해 훅 상한을 다르게 준다.
function wantsDeep(request) {
  return String(request.query?.deep || "") === "1";
}
// 자기 자신을 부를 주소. 크론 호출에는 host 헤더가 없거나 배포 별칭과 다를 수 있어
// Vercel이 넣어 주는 운영 배포 URL 환경변수를 우선하고, 없을 때만 요청 헤더로 떨어진다.
function chainBaseUrl(request) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    || request.headers["x-forwarded-host"] || request.headers.host;
  return host ? `https://${host}` : null;
}
// 이 호출이 내부 체인의 몇 번째인지. 바깥(크론·화면)에서 온 첫 호출은 0이다.
function chainDepth(request) {
  return Math.max(0, Number(request.query?.chain) || 0);
}

async function chainStage(request, stage, hop = 1, { curate = wantsCurate(request), deep = wantsDeep(request) } = {}) {
  const secret = process.env.CRON_SECRET;
  const base = chainBaseUrl(request);
  if (!secret || !base) {
    console.error("[STAGE_CHAIN_SKIPPED]", JSON.stringify({ stage, reason: !secret ? "no_cron_secret" : "no_host" }));
    return;
  }
  const depth = chainDepth(request) + 1;
  if (depth > MAX_CHAIN_DEPTH) {
    // 5번째 내부 호출은 508로 거부된다. 나가지도 않을 요청을 보내는 대신 이유를 남기고 멈춘다.
    console.error("[STAGE_CHAIN_DEPTH_CAP]", JSON.stringify({ stage, hop, depth }));
    await logPipeline(stage, { message: "chain depth cap", stage, hop, depth, run_id: request.query?.run_id }, { hop, status: "skipped", durationMs: 0 }).catch(() => {});
    return;
  }
  const url = `${base}/api/ingest-rss?stage=${encodeURIComponent(stage)}&hop=${hop}&chain=${depth}${curate ? "&curate=1" : ""}${deep ? "&deep=1" : ""}&run_id=${encodeURIComponent(request.runId || request.query?.run_id || '')}${request.query?.pilot === '1' ? '&pilot=1' : ''}`;
  // 호출이 "나갔다"는 것만 보장하고 응답은 기다리지 않는다.
  //   - waitUntil로만 넘기면 크론처럼 응답을 기다리는 쪽이 없는 실행에서 fetch가 나가기도 전에 함수가 끝난다.
  //   - 그렇다고 응답을 끝까지 await하면 앞 단계가 뒷 단계 작업을 기다리며 직렬로 늘어붙어
  //     한 요청이 60초 제한을 넘겨 펜딩된다.
  // 그래서 짧은 타임아웃을 걸고, 타임아웃(=이미 전송됨)은 성공으로 본다.
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(CHAIN_HANDOFF_MS),
    });
    console.info("[STAGE_CHAINED]", JSON.stringify({ stage, hop, status: upstream.status }));
  } catch (error) {
    // TimeoutError는 요청이 이미 전송된 뒤 응답만 못 기다린 것이므로 실패가 아니다.
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      console.info("[STAGE_CHAINED]", JSON.stringify({ stage, hop, status: "handoff" }));
    } else {
      console.error("[STAGE_CHAIN_FAILED]", JSON.stringify({ stage, hop, message: error.message }));
    }
  }
}

// 본문 처리 단계. 헤드라인을 골라 예산 안에서 처리한다. 훅은 한 호출 안에서 이어 돌리고(체인 깊이를
// 아끼려고), 호출 예산이 다하면 자신을 한 번 더 부르며, 끝나면 Daily를 부른다.
async function runProcessStage(request, startHop) {
  const invocationStarted = Date.now();
  const hopCap = wantsDeep(request) ? MAX_PROCESS_HOPS : MANUAL_PROCESS_HOPS;
  let hop = startHop;
  let more = false;
  for (;;) {
    more = await runProcessHop(request, hop, hopCap);
    if (!more || hop >= hopCap || Date.now() - invocationStarted > INVOCATION_BUDGET_MS) break;
    hop += 1;
  }
  if (more && hop < hopCap) await chainStage(request, "process", hop + 1);
  else await chainStage(request, "daily");
  await flushTraces();
}

// 본문 처리 훅 하나. 남은 일이 있으면 true.
async function runProcessHop(request, hop, hopCap) {
  const started = Date.now();
  const selected = await selectHeadlineTop10(request.query?.pilot === '1');
  const results = selected.length ? await processSelectedBatch(selected, started + STAGE_BUDGET_MS) : [];
  const counts = results.reduce((acc, result) => ({ ...acc, [result.status]: (acc[result.status] || 0) + 1 }), {});
  const attempted = new Set(results.map((result) => result.articleId));
  const leftover = selected.filter((article) => !attempted.has(article.id)).length;
  // 한 훅은 상위 10건만 집는다. 예전에는 그 10건을 다 처리하면 바로 Daily로 넘어가, 그날 수집분이
  // 20~30건이어도 10건만 읽고 끝났다. 배치가 가득 찼다면 아직 남았다는 뜻이므로 다음 훅으로 이어 간다.
  const batchWasFull = selected.length >= TOP10_LIMIT;
  const more = leftover > 0 || batchWasFull;
  console.info("[PROCESS_STAGE]", JSON.stringify({ hop, hopCap, selected: selected.length, processed: results.length, leftover, more, counts, ms: Date.now() - started }));
  await logPipeline("process", {
    run_id: request.query?.run_id, pilot: request.query?.pilot === '1', chain_depth: chainDepth(request),
    hopCap, selected: selected.map((a) => ({ id: a.id, title: String(a.title_original || "").slice(0, 120), source: a.source_name, tier: a.source_tier, score: Math.round(a.headline_score) })),
    outcomes: results.map((r) => ({ articleId: r.articleId, status: r.status, reason: String(r.reason || r.message || "").slice(0, 300), chunks: r.embedding?.chunks ?? null, duplicate: r.duplicate || false, primary: r.primary_provider, verifier: r.verifier_provider })),
    counts, leftover, more,
  }, { hop, durationMs: Date.now() - started });
  return more;
}

async function runDailyStage(request) {
  const started = Date.now();
  // 3개사 파일럿은 검증용이다. 그 기사만으로 오늘 Daily를 덮어쓰면 운영 리포트가 훼손된다.
  if (request.query?.pilot === '1') {
    await logPipeline("daily", { status: "skipped_pilot", run_id: request.query?.run_id }, { durationMs: 0 });
    await flushTraces();
    return;
  }
  try {
    const report = await retryOnceOnTimeout(
      () => generateDailyReport(),
      { delayMs: 1500 },
    );
    console.info("[DAILY_STAGE]", JSON.stringify({ status: report.status, top10: report.top10_count || 0, ms: Date.now() - started }));
    await logPipeline("daily", { status: report.status, top10: report.top10_count || 0, report_date: report.report_date || null }, { durationMs: Date.now() - started });
  } catch (error) {
    console.error("[DAILY_STAGE_FAILED]", JSON.stringify({ message: error.message }));
    await logPipeline("daily", { message: error.message }, { status: "failed", durationMs: Date.now() - started });
  }
  // Daily가 끝나면 시계열 유지 작업으로 넘어간다. 단, 크론이 시작한 실행일 때만. 수동 수집은 여기서 끝난다.
  if (wantsCurate(request)) await chainStage(request, "curate", 1);
  else console.info("[CURATE_SKIPPED]", JSON.stringify({ reason: "manual_run" }));
  await flushTraces();
}

// 유지 단계. 아직 안 읽은 정기보고서를 읽고, 시점을 다시 확인하고, 벡터를 메운다.
// 훅은 한 호출 안에서 이어 돌리고, 호출 예산이 다하면(그리고 체인 깊이가 남으면) 자신을 한 번 더 부른다.
async function runCurateStage(request, startHop) {
  const invocationStarted = Date.now();
  let hop = startHop;
  let more = false;
  for (;;) {
    more = await runCurateHop(request, hop);
    if (!more || hop >= MAX_CURATE_HOPS || Date.now() - invocationStarted > INVOCATION_BUDGET_MS) break;
    hop += 1;
  }
  if (more && hop < MAX_CURATE_HOPS) await chainStage(request, "curate", hop + 1);
  await flushTraces();
}

// 유지 훅 하나. 남은 일이 있으면 true. 훅 자체가 예외로 죽으면 그 밤은 거기서 멈춘다(원인을 로그에 남긴다).
async function runCurateHop(request, hop) {
  const started = Date.now();
  try {
    const result = await runCurationHop({ deadline: started + CURATE_BUDGET_MS, hop });
    console.info("[CURATE_STAGE]", JSON.stringify({ hop, ...result.log, more: result.more, ms: Date.now() - started }));
    await logPipeline("curate", { ...result.log, more: result.more, chain_depth: chainDepth(request) }, { hop, durationMs: Date.now() - started });
    return result.more;
  } catch (error) {
    console.error("[CURATE_STAGE_FAILED]", JSON.stringify({ hop, message: error.message }));
    await logPipeline("curate", { message: error.message, chain_depth: chainDepth(request) }, { hop, status: "failed", durationMs: Date.now() - started });
    return false;
  }
}

// 관리자 화면의 수동 백필은 브라우저가 한 홉씩 호출한다. 같은 Vercel 함수가 자기 자신을 5번째
// 호출하면 508 Loop Detected가 나므로, 수동 실행에서는 서버 재귀 체인을 만들지 않는다.
async function runManualCurateStep(response, hop) {
  const started = Date.now();
  try {
    const result = await runCurationHop({ deadline: started + CURATE_BUDGET_MS, hop });
    await logPipeline("curate", { ...result.log, more: result.more, manual_step: true }, { hop, durationMs: Date.now() - started });
    await flushTraces();
    return response.status(200).json({ status: "ok", hop, more: result.more, task: result.log.hop_task, result: result.log[result.log.hop_task] || null });
  } catch (error) {
    await logPipeline("curate", { message: error.message, manual_step: true }, { hop, status: "failed", durationMs: Date.now() - started });
    await flushTraces();
    return response.status(502).json({ status: "failed", hop, message: error.message });
  }
}

async function runManualRenewStep(response) {
  const started = Date.now();
  try {
    const result = await runReportRenewal();
    await logPipeline("curate", { hop_task: "renew", renew: result, manual_step: true }, { durationMs: Date.now() - started });
    await flushTraces();
    return response.status(200).json({ status: "ok", task: "renew", result, more: result.status !== "idle" });
  } catch (error) {
    await logPipeline("curate", { hop_task: "renew", message: error.message, manual_step: true }, { status: "failed", durationMs: Date.now() - started });
    await flushTraces();
    return response.status(500).json({ status: "failed", task: "renew", message: error.message, more: true });
  }
}

// 이미 저장된 연차보고서 이벤트의 시점을 다시 확인한다.
// 기간 집계는 보고 기간 말일이 맞으므로 그대로 두고, 시점 사건만 실제 시기를 찾아 고친다.
async function runRedate(response, companyId) {
  const company = COMPANIES.find((item) => item.id === companyId);
  if (!company) return response.status(404).json({ status: "unknown_company", company_id: companyId });
  if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
  try {
    // 아직 확인하지 않은 것만 집는다. 한 번 확인한 이벤트를 다시 검색하면 비용만 든다.
    const events = await supabaseRest(`event?select=id,occurred_at,title_ko,fact_ko&company_id=eq.${encodeURIComponent(companyId)}&evidence_kind=eq.annual_report&occurred_basis=is.null&order=occurred_at.asc&limit=20`);
    if (!events.length) return response.status(200).json({ status: "ok", company_id: companyId, company_name: company.name_ko, checked: 0, changed: 0, remaining: 0 });
    const { items, checked, provider } = await redateReportEvents({ company, events });
    let changed = 0;
    for (const item of items) {
      await supabaseRest(`event?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { occurred_at: item.occurred_at, occurred_precision: item.occurred_precision, occurred_basis: item.occurred_basis }
      });
      if (item.changed) changed += 1;
    }
    // 시점이 바뀐 이벤트는 벡터 청크의 [시점] 줄도 달라지므로 다시 임베딩한다.
    let embedded = 0;
    if (items.length) {
      try {
        const updated = await supabaseRest(`event?select=*&id=in.(${items.map((item) => item.id).join(",")})`);
        embedded = (await embedEvents((updated || []).map((row) => ({ ...row, company_name_ko: company.name_ko })))).chunks;
      } catch (error) {
        console.error("[REDATE_EMBEDDING_FAILED]", JSON.stringify({ companyId, message: error.message }));
      }
    }
    const left = await supabaseRest(`event?select=id&company_id=eq.${encodeURIComponent(companyId)}&evidence_kind=eq.annual_report&occurred_basis=is.null&limit=200`);
    console.info("[REDATE_DONE]", JSON.stringify({ companyId, checked, changed, remaining: left.length }));
    return response.status(200).json({ status: "ok", company_id: companyId, company_name: company.name_ko, checked, changed, embedded, remaining: left.length, provider });
  } catch (error) {
    console.error("[REDATE_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: "redate_failed", company_id: companyId, message: error.message });
  }
}

async function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isCronRequest(request) && !requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });
  if (request.query?.pilot === '1' && !request.query?.stage && request.method === 'GET') {
    response.setHeader('Content-Type','text/html; charset=utf-8');
    return response.status(200).send('<!doctype html><meta charset="utf-8"><h1>3개 회사 실서비스 검증</h1><p>CATL·후난위넝·BTR. 회사당 검색 요청 1회씩, 요청당 기사 최대 2건. 본문 처리까지만 하고 Daily는 생성하지 않습니다.</p><form method="post" action="?pilot=1&process=1"><button onclick="this.disabled=true;this.form.submit()">3개 회사 테스트 1회 실행</button></form>');
  }
  // Explicit, authenticated diagnostic. GET never starts a paid request.
  if (request.query?.deepseek_sample === '1') {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.status(200).send('<!doctype html><html lang="ko"><meta charset="utf-8"><title>DeepSeek 샘플</title><h1>CATL 검색 샘플 1회</h1><p>최근 30일, 최대 2건. 전체 수집·기사 저장·Daily 생성은 실행하지 않습니다. API 비용이 발생하며 검색 도구 호출 수는 공급자가 결정합니다.</p><form method="post"><button onclick="this.disabled=true;this.form.submit()">샘플 검색 1회 실행</button></form></html>');
    }
    try {
      const result = await createJsonResponse({
        provider: 'deepseek', webSearch: true, name: 'deepseek_catl_sample',
        instructions: '웹 검색으로 CATL(宁德时代, 한국어 닝더스다이)의 최근 30일 주요 사업 뉴스를 찾아라. 검색은 한 번만 하고 즉시 종료하라. 최대 2건이며 없으면 빈 배열. 출처 URL을 반드시 포함하고 없는 사실은 만들지 마라.',
        input: `기준일 ${new Date().toISOString().slice(0, 10)}. 회사는 CATL 하나만.`,
        schema: { type: 'object', additionalProperties: false, required: ['articles'], properties: { articles: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['title', 'url', 'summary'], properties: { title: { type: 'string' }, url: { type: 'string' }, summary: { type: 'string' } } } } } }
      });
      return response.status(200).json({ status: 'sample_complete', ...result });
    } catch (error) {
      return response.status(502).json({ status: 'sample_failed', message: error.message, note: '응답을 수신했다면 pipeline_log의 search_response_raw 기록을 확인하세요. 자동 재시도 없음.' });
    }
  }
  // 정기보고서 원문을 읽어 시계열을 채운다. kind는 annual(과거)·semiannual·quarterly(현행).
  const digestCompanyId = String(request.query?.digest || request.body?.digest || "").trim();
  if (digestCompanyId) {
    const requested = String(request.query?.kind || request.body?.kind || "annual").trim();
    const kind = ["annual", "semiannual", "quarterly"].includes(requested) ? requested : "annual";
    return runBackfill(response, digestCompanyId, null, kind);
  }
  const redateCompanyId = String(request.query?.redate || request.body?.redate || "").trim();
  if (redateCompanyId) return runRedate(response, redateCompanyId);
  // 기사 청크 형식 재구성. 기본은 미리보기이며, write는 최대 20기사를 한 요청에서 안전하게 교체한다.
  const articleChunkMode = String(request.query?.article_chunks || request.body?.article_chunks || "").trim();
  if (articleChunkMode) return runArticleChunkRestructure(response, articleChunkMode === "write", request.query?.limit || request.body?.limit);
  // 정기보고서 발췌에서 정량 지표를 뽑아 report_metric을 채운다. LLM을 쓰지 않는다.
  // ?metrics=1은 미리보기(쓰지 않음), ?metrics=write는 실제 upsert. 기본이 미리보기인 이유는
  // 무엇이 들어가는지 먼저 눈으로 보고 쓰기를 하기 위해서다.
  const metricsMode = String(request.query?.metrics || request.body?.metrics || "").trim();
  if (metricsMode) return runMetricBackfill(response, metricsMode === "write");
  // 거래소 표준 손익 항목(영업이익 포함)을 데이터 제공자에서 받아 market_financial을 채운다.
  // 역시 LLM을 쓰지 않는다. ?financials=1 미리보기 / ?financials=write 적재.
  const financialsMode = String(request.query?.financials || request.body?.financials || "").trim();
  if (financialsMode) return runFinancialBackfill(response, financialsMode === "write", String(request.query?.only || "").trim());
  // 기간별 평균 환율. 재무 표에 실제로 있는 기간만 채운다. ?fx=1 미리보기 / ?fx=write 적재.
  const fxMode = String(request.query?.fx || request.body?.fx || "").trim();
  if (fxMode) return runFxBackfill(response, fxMode === "write");
  // 브라우저가 한 홉씩 부르는 수동 백필. 서버가 자기 자신을 재귀 호출하지 않는다.
  if (request.method === "POST" && String(request.query?.curate_step || "") === "1") {
    if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
    if (String(request.query?.task || "") === "renew") return runManualRenewStep(response);
    const hop = Math.min(MAX_CURATE_HOPS, Math.max(1, Number(request.query?.hop) || 1));
    return runManualCurateStep(response, hop);
  }
  // 레거시·내부 시계열 백필 시작점.
  if (request.method === "POST" && String(request.query?.curate_run || "") === "1") {
    if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
    await chainStage(request, "curate", 1, { curate: true });
    return response.status(202).json({ status: "started", stage: "curate", next_step: "정기보고서 읽기·보강·시점 재확인이 서버에서 호출 4번(호출당 약 3분)까지 이어집니다. 더 많이 돌리려면 화면의 시계열 백필 버튼을 쓰세요." });
  }
  // 이어 붙은 단계 호출. 곧바로 응답하고 일은 waitUntil 안에서 마저 한다.
  const stageName = String(request.query?.stage || "").trim();
  if (stageName) {
    if (!isCronRequest(request)) return response.status(403).json({ status: "stage_requires_cron_secret" });
    const hop = Math.max(1, Number(request.query?.hop) || 1);
    if (['process','daily'].includes(stageName)) {
      if (!await claimStage(request.query?.run_id, stageName, hop)) return response.status(409).json({status:'duplicate_or_expired_stage'});
    }
    if (stageName === "process") waitUntil(runProcessStage(request, hop));
    else if (stageName === "daily") waitUntil(runDailyStage(request).finally(() => releaseRun(request.query.run_id)));
    else if (stageName === "curate") waitUntil(runCurateStage(request, hop));
    else return response.status(400).json({ status: "unknown_stage", stage: stageName });
    return response.status(202).json({ status: "accepted", stage: stageName, hop });
  }
  const backfillCompanyId = String(request.query?.backfill || request.body?.backfill || "").trim();
  if (backfillCompanyId) return runBackfill(response, backfillCompanyId, request.query?.since || request.body?.since, "web");
  let stage = "company_seed";
  const collectStarted = Date.now();
  let runId;
  try {
    runId = await acquireRun();
    if (!runId) return response.status(409).json({status:'collection_in_progress',message:'다른 수집·본문 처리·Daily 생성이 진행 중입니다. 추가 실행은 차단했습니다. 중단된 실행의 잠금은 마지막 단계 시작 후 최대 10분 뒤 만료됩니다.'});
    request.runId = runId;
    await supabaseRest("company?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: [...COMPANIES, POLICY_COMPANY].map(({ id, name_ko, name_zh, name_en, type_tags }) => ({ id, name_ko, name_zh, name_en, type_tags })) });
    stage = "source_collection";
    const isPilot = request.query?.pilot === '1';
    // 파일럿(3개사 검증)은 bootstrap을 켜지 않는다. 검증 대상이 정해져 있어 과거 백필이 필요 없다.
    const bootstrapIds = isPilot ? [] : await bootstrapCompanyIds();
    const activeCompanies = await trackedCompanies();
    const searchBudget = searchBudgetFor(plannedSearchRequests(isPilot, bootstrapIds, activeCompanies));
    const candidates = await withSearchBudget(() => discoverChinaSources({pilot: isPilot, bootstrapCompanyIds: bootstrapIds}), searchBudget);
    stage = "company_matching";
    const matchedCandidates = candidates
      .map((candidate) => ({ candidate, companies: companiesFor(candidate, activeCompanies) }))
      .filter(({ companies }) => companies.length);
    const articleRows = matchedCandidates.map(({ candidate }) => ({
        canonical_url: candidate.url, source_name: candidate.source, title_original: candidate.title,
        source_language: "zh", published_at: safePublishedAt(candidate.publishedAt),
        verification_status: "pending", source_tier: candidate.kind === "disclosure" ? "official_disclosure" : candidate.kind === "policy_news" ? `web_search_policy_${candidate.searchProvider || "discovered"}` : candidate.kind === "web_search_news" ? `web_search_${candidate.bootstrap ? "bootstrap_" : ""}${candidate.searchProvider || "discovered"}` : "needs_review",
        discovered_via: discoveredVia(candidate),
    }));
    stage = "article_storage";
    // 같은 URL이 다시 발견되면 기존 행을 건드리지 않는다.
    // 전에는 merge-duplicates로 덮어써서, 검증을 통과한 기사가 다음 날 밤 재발견되면
    // verification_status가 pending으로, source_tier가 web_search_*로 되돌아가 화면에서 사라졌다
    // (CNINFO는 14일 창을 매일 다시 훑으므로 공시는 거의 항상 재발견된다).
    // 새로 들어간 행만 응답에 오므로, 기존 행의 id는 URL로 따로 찾아 회사 연결에 쓴다.
    const insertedArticles = articleRows.length
      ? await supabaseRest("article?on_conflict=canonical_url", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: articleRows })
      : [];
    const idByUrl = new Map((insertedArticles || []).map((article) => [article.canonical_url, article.id]));
    const existingUrls = articleRows.map((row) => row.canonical_url).filter((url) => !idByUrl.has(url));
    for (let i = 0; i < existingUrls.length; i += 40) {
      const batch = existingUrls.slice(i, i + 40).map((url) => `"${url.replace(/"/g, '\\"')}"`).join(",");
      const rows = await supabaseRest(`article?select=id,canonical_url&canonical_url=in.(${encodeURIComponent(batch)})`);
      for (const row of rows || []) idByUrl.set(row.canonical_url, row.id);
    }
    const storedArticles = insertedArticles || [];
    const companyLinks = matchedCandidates.flatMap(({ candidate, companies }) =>
      companies.map((company) => ({ article_id: idByUrl.get(candidate.url), company_id: company.id }))
    ).filter((link) => link.article_id);
    stage = "company_linking";
    if (companyLinks.length) {
      await supabaseRest("article_company?on_conflict=article_id,company_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: companyLinks });
    }
    stage = "headline_selection";
    const immediateAnalysis = request.query?.process === "1" || request.body?.process === true;
    const shouldProcess = isCronRequest(request) || immediateAnalysis;
    const llmReady = Boolean(process.env.DEEPSEEK_API_KEY || (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL));
    // 본문 처리와 Daily 생성은 이 호출에서 하지 않는다. 60초 안에 다 못 끝나 Daily가 빠지던 원인이다.
    // 다음 단계를 새 호출로 넘기고 여기서는 수집 결과만 돌려준다.
    // 크론이 시작한 실행만 깊게 돈다(훅 6회). 화면 버튼은 한 훅만 돌아 1분 안팎에 끝난다.
    // 재무 자동 갱신. 크론 실행에서만, 주기가 지났을 때만 돈다. LLM을 쓰지 않아 비용이 없고,
    // 실패해도 수집 결과를 버리지 않는다(실패는 자기 로그에 남고 화면이 그것을 읽는다).
    if (isCronRequest(request)) {
      try { await refreshFinancialsIfDue(); }
      catch (error) { console.error("[FINANCIAL_REFRESH_FAILED]", JSON.stringify({ message: error.message })); }
    }
    const discovery = discoveryStats() || {};
    await logPipeline("collect", {
      run_id: runId, request_limits: searchBudget,
      pilot: request.query?.pilot === '1', bootstrap_ids: bootstrapIds,
      trigger: isCronRequest(request) ? "cron" : "manual",
      raw: discovery.raw || {}, failed: discovery.failed || [], unique: candidates.length, by_via: discovery.by_via || {},
      web_search: discovery.web_search || [],
      matched: matchedCandidates.length, unmatched: candidates.length - matchedCandidates.length,
      new_articles: storedArticles.length, existing: existingUrls.length,
      new_by_via: storedArticles.reduce((acc, row) => ({ ...acc, [row.discovered_via || "other"]: (acc[row.discovered_via || "other"] || 0) + 1 }), {}),
      new_titles: storedArticles.slice(0, 80).map((row) => ({ id: row.id, via: row.discovered_via, source: row.source_name, title: String(row.title_original || "").slice(0, 120) })),
      unmatched_sample: candidates.filter((c) => !companiesFor(c, activeCompanies).length).slice(0, 30).map((c) => ({ via: discoveredVia(c), source: c.source, title: String(c.title || "").slice(0, 120) })),
      process_started: Boolean(shouldProcess && llmReady),
    }, { durationMs: Date.now() - collectStarted });
    if (shouldProcess && llmReady) await chainStage(request, "process", 1, { curate: isCronRequest(request), deep: isCronRequest(request) });
    else await releaseRun(runId);
    return response.status(200).json({
      status: shouldProcess && llmReady ? "started" : "ok",
      run_id: runId, request_limits: searchBudget,
      search_runs: (discovery.web_search || []).length, discovered: candidates.length, stored: storedArticles.length,
      next_step: shouldProcess && llmReady
        ? "본문 처리와 Daily 생성이 별도 호출로 이어집니다. 몇 분 뒤 첫 화면에 반영됩니다."
        : "process=1 또는 크론이 본문 분석을 시작합니다."
    });
  } catch (error) {
    if (runId) await releaseRun(runId).catch(() => {});
    console.error("[INGESTION_FAILED]", JSON.stringify({ stage, message: error.message }));
    await logPipeline("collect", { stage, message: error.message }, { status: "failed", durationMs: Date.now() - collectStarted });
    return response.status(502).json({ status: "ingestion_failed", stage, message: error.message });
  }
}

// 서버리스 함수는 응답 직후 종료돼 배경 전송이 유실된다. 끝나기 전에 추적을 밀어 넣는다.
export default async function handler(request, response) {
  try {
    return await handleRequest(request, response);
  } finally {
    await flushTraces();
  }
}
