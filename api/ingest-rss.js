import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { requireAccess } from "../lib/access.js";
import { processPendingArticle, recordProcessing } from "./process-article.js";
import { generateDailyReport } from "./generate-daily.js";
import { waitUntil } from "@vercel/functions";
import { runCurationHop } from "../lib/curation.js";
import { COMPANIES, companiesFor, discoverChinaSources, discoveredVia, discoveryStats } from "../lib/china-sources.js";
import { logPipeline } from "../lib/pipeline-log.js";
import { llmConfig, createJsonResponse } from "../lib/llm-provider.js";
import { backfillCompanyEvents, digestReport, redateReportEvents } from "../lib/event-backfill.js";
import { embedEvents } from "../lib/vector-ingestion.js";

export const maxDuration = 60;

const TOP10_LIMIT = 10;
// 본문 분석 후보로 볼 기간. 수집이 최근 3일치를 훑으므로 같은 창으로 맞춘다.
const PROCESS_WINDOW_DAYS = 3;
const PROCESS_CONCURRENCY = 3;
// 한 함수는 60초 안에 끝나야 한다. 본문 처리는 이 시간까지만 새 기사를 집고 나머지는 다음 호출로 넘긴다.
const STAGE_BUDGET_MS = 42000;
// 다음 단계 호출을 넘기고 기다리는 최대 시간. 요청이 나갔는지만 확인하면 되므로 짧게 둔다.
const CHAIN_HANDOFF_MS = 1500;
// 본문 처리 호출을 최대 몇 번 이어 붙일지. 하루치 헤드라인 10건이면 두어 번이면 끝난다.
// 야간 크론은 기다리는 사람이 없으니 넉넉히 이어 붙여 그날 수집분을 최대한 소화한다.
const MAX_PROCESS_HOPS = 6;
// 화면 버튼으로 도는 실행은 사용자가 결과를 보려고 누른 것이라 한 훅만 돌고 끝낸다.
// 상위 10건을 읽고 바로 Daily로 넘어가므로 1분 안팎에 끝난다.
const MANUAL_PROCESS_HOPS = 1;
// 유지 단계(보고서 읽기·시점 재확인·임베딩) 호출을 한 번의 실행에서 최대 몇 번 이어 붙일지.
// 회사 23곳 × 최근 3년 보고서 6건이면 백여 건이라, 처음 며칠은 한 실행에 수십 번 이어야 한다.
const MAX_CURATE_HOPS = 40;
// 60초 함수 안에서 검색 1회 + 추출이 끝나야 하므로 회사당 건수를 낮춘다.
const BACKFILL_MAX_EVENTS = 12;
const BACKFILL_SINCE = "2023-01-01";
const DIGEST_MAX_EVENTS = 10;
const HIGH_SIGNAL_TERMS = [
  "扩产", "增产", "产能", "投产", "开工", "项目", "签约", "订单", "定点", "认证", "量产", "出货", "交付",
  "营收", "收入", "净利润", "财报", "业绩", "海外", "建厂", "投资", "收购", "合作", "固态", "硅碳", "lmfp",
  "磷酸锰铁锂", "钠电", "专利", "标准", "回收", "capacity", "production", "order", "certification", "shipment",
  "revenue", "overseas", "investment", "acquisition", "solid-state", "silicon"
];
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

async function selectHeadlineTop10() {
  // 본문을 못 가져온 기사는 다시 집어도 같은 결과다. 한 회차 본문 분석 예산이 열 건뿐이라
  // 죽은 URL이 그 자리를 계속 차지하면 새 기사가 밀린다. body_unavailable과 body_too_short는
  // URL 자체가 쓸모없다는 뜻이므로 제외하고, processing_failed는 일시적 오류일 수 있어 다시 시도한다.
  //
  // 후보는 최근 며칠치로 끊는다. 예전에는 미처리 기사 전체(수년치)를 놓고 점수를 매겨,
  // 신호 단어가 많은 옛 기사가 오늘 기사를 계속 밀어내고 재고만 쌓였다. Daily는 오늘 것을
  // 읽는 게 목적이므로, 그 창을 벗어난 기사는 다시 집지 않고 흘려보낸다.
  const since = new Date(Date.now() - PROCESS_WINDOW_DAYS * 86400000).toISOString();
  const [rows, preference] = await Promise.all([
    supabaseRest(`article?select=id,title_original,source_name,source_tier,published_at,article_company(company_id)&verification_status=eq.pending&or=(processing_status.is.null,processing_status.eq.processing_failed)&published_at=gte.${since}&order=published_at.desc&limit=500`),
    feedbackPreference(),
  ]);
  const unique = new Map();
  for (const article of rows) {
    const key = normalizeHeadline(article.title_original);
    if (key && !unique.has(key)) unique.set(key, article);
  }
  return [...unique.values()]
    // 웹 검색 기사·CATL 뉴스룸에 더해 거래소 공시(1차 출처)도 본문 분석 대상에 넣는다.
    .filter((article) => article.source_tier.startsWith("web_search_") || article.source_tier === "official_disclosure" || article.source_name === "CATL Newsroom")
    .map((article) => ({ ...article, headline_score: headlineScore(article, preference) }))
    .sort((a, b) => b.headline_score - a.headline_score || new Date(b.published_at) - new Date(a.published_at))
    .slice(0, TOP10_LIMIT);
}

async function processSelectedBatch(rows, deadline = Infinity) {
  const outcomes = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROCESS_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      // 예산이 다하면 남은 기사는 다음 호출이 이어받는다. 기사 하나를 반쯤 처리하다 잘리는 것보다 낫다.
      if (Date.now() > deadline) break;
      const article = rows[next++];
      const companyId = article.article_company?.[0]?.company_id;
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
      ? await digestReport({ company, kind: mode, maxEvents: DIGEST_MAX_EVENTS })
      : await backfillCompanyEvents({ company, since, until, maxEvents: BACKFILL_MAX_EVENTS });
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
async function chainStage(request, stage, hop = 1, { curate = wantsCurate(request), deep = wantsDeep(request) } = {}) {
  const secret = process.env.CRON_SECRET;
  const base = chainBaseUrl(request);
  if (!secret || !base) {
    console.error("[STAGE_CHAIN_SKIPPED]", JSON.stringify({ stage, reason: !secret ? "no_cron_secret" : "no_host" }));
    return;
  }
  const url = `${base}/api/ingest-rss?stage=${encodeURIComponent(stage)}&hop=${hop}${curate ? "&curate=1" : ""}${deep ? "&deep=1" : ""}`;
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

// 본문 처리 단계. 헤드라인을 골라 예산 안에서 처리하고, 남으면 자신을 다시 부르고, 끝나면 Daily를 부른다.
async function runProcessStage(request, hop) {
  const started = Date.now();
  const selected = await selectHeadlineTop10();
  const results = selected.length ? await processSelectedBatch(selected, started + STAGE_BUDGET_MS) : [];
  const counts = results.reduce((acc, result) => ({ ...acc, [result.status]: (acc[result.status] || 0) + 1 }), {});
  const attempted = new Set(results.map((result) => result.articleId));
  const leftover = selected.filter((article) => !attempted.has(article.id)).length;
  // 한 훅은 상위 10건만 집는다. 예전에는 그 10건을 다 처리하면 바로 Daily로 넘어가, 그날 수집분이
  // 20~30건이어도 10건만 읽고 끝났다. 배치가 가득 찼다면 아직 남았다는 뜻이므로 다음 훅으로 이어 간다.
  const batchWasFull = selected.length >= TOP10_LIMIT;
  const more = leftover > 0 || batchWasFull;
  const hopCap = wantsDeep(request) ? MAX_PROCESS_HOPS : MANUAL_PROCESS_HOPS;
  console.info("[PROCESS_STAGE]", JSON.stringify({ hop, hopCap, selected: selected.length, processed: results.length, leftover, more, counts, ms: Date.now() - started }));
  await logPipeline("process", {
    hopCap, selected: selected.map((a) => ({ id: a.id, title: String(a.title_original || "").slice(0, 120), source: a.source_name, tier: a.source_tier, score: Math.round(a.headline_score) })),
    outcomes: results.map((r) => ({ articleId: r.articleId, status: r.status, reason: String(r.reason || r.message || "").slice(0, 300), chunks: r.embedding?.chunks ?? null, duplicate: r.duplicate || false, primary: r.primary_provider, verifier: r.verifier_provider })),
    counts, leftover, more,
  }, { hop, durationMs: Date.now() - started });
  if (more && hop < hopCap) await chainStage(request, "process", hop + 1);
  else await chainStage(request, "daily");
  await flushTraces();
}

async function runDailyStage(request) {
  const started = Date.now();
  try {
    const report = await generateDailyReport();
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

// 유지 단계. 아직 안 읽은 정기보고서를 읽고, 시점을 다시 확인하고, 벡터를 메운다. 남으면 자신을 다시 부른다.
async function runCurateStage(request, hop) {
  const started = Date.now();
  let more = false;
  try {
    const result = await runCurationHop({ deadline: started + STAGE_BUDGET_MS });
    more = result.more;
    console.info("[CURATE_STAGE]", JSON.stringify({ hop, ...result.log, more, ms: Date.now() - started }));
    await logPipeline("curate", { ...result.log, more }, { hop, durationMs: Date.now() - started });
  } catch (error) {
    console.error("[CURATE_STAGE_FAILED]", JSON.stringify({ hop, message: error.message }));
    await logPipeline("curate", { message: error.message }, { hop, status: "failed", durationMs: Date.now() - started });
  }
  if (more && hop < MAX_CURATE_HOPS) await chainStage(request, "curate", hop + 1);
  await flushTraces();
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
  // 시계열 백필 1회 실행. 화면 버튼이 부른다(입장 세션). 뉴스 수집과 달리 유지 단계만 돌린다.
  if (request.method === "POST" && String(request.query?.curate_run || "") === "1") {
    if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
    await chainStage(request, "curate", 1, { curate: true });
    return response.status(202).json({ status: "started", stage: "curate", next_step: "정기보고서 읽기·보강·시점 재확인이 서버에서 최대 40회 이어집니다. 20~30분 뒤 기업 분석을 새로 고침하면 반영됩니다." });
  }
  // 이어 붙은 단계 호출. 곧바로 응답하고 일은 waitUntil 안에서 마저 한다.
  const stageName = String(request.query?.stage || "").trim();
  if (stageName) {
    if (!isCronRequest(request)) return response.status(403).json({ status: "stage_requires_cron_secret" });
    const hop = Math.max(1, Number(request.query?.hop) || 1);
    if (stageName === "process") waitUntil(runProcessStage(request, hop));
    else if (stageName === "daily") waitUntil(runDailyStage(request));
    else if (stageName === "curate") waitUntil(runCurateStage(request, hop));
    else return response.status(400).json({ status: "unknown_stage", stage: stageName });
    return response.status(202).json({ status: "accepted", stage: stageName, hop });
  }
  const backfillCompanyId = String(request.query?.backfill || request.body?.backfill || "").trim();
  if (backfillCompanyId) return runBackfill(response, backfillCompanyId, request.query?.since || request.body?.since, "web");
  let stage = "company_seed";
  const collectStarted = Date.now();
  try {
    await supabaseRest("company?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: COMPANIES.map(({ id, name_ko, name_zh, name_en, type_tags }) => ({ id, name_ko, name_zh, name_en, type_tags })) });
    stage = "source_collection";
    const candidates = await discoverChinaSources();
    stage = "company_matching";
    const matchedCandidates = candidates
      .map((candidate) => ({ candidate, companies: companiesFor(candidate) }))
      .filter(({ companies }) => companies.length);
    const articleRows = matchedCandidates.map(({ candidate }) => ({
        canonical_url: candidate.url, source_name: candidate.source, title_original: candidate.title,
        source_language: "zh", published_at: safePublishedAt(candidate.publishedAt),
        verification_status: "pending", source_tier: candidate.kind === "disclosure" ? "official_disclosure" : candidate.kind === "web_search_news" ? `web_search_${candidate.searchProvider || "discovered"}` : "needs_review",
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
    const discovery = discoveryStats() || {};
    await logPipeline("collect", {
      trigger: isCronRequest(request) ? "cron" : "manual",
      raw: discovery.raw || {}, failed: discovery.failed || [], unique: candidates.length, by_via: discovery.by_via || {},
      web_search: discovery.web_search || [],
      matched: matchedCandidates.length, unmatched: candidates.length - matchedCandidates.length,
      new_articles: storedArticles.length, existing: existingUrls.length,
      new_by_via: storedArticles.reduce((acc, row) => ({ ...acc, [row.discovered_via || "other"]: (acc[row.discovered_via || "other"] || 0) + 1 }), {}),
      new_titles: storedArticles.slice(0, 80).map((row) => ({ id: row.id, via: row.discovered_via, source: row.source_name, title: String(row.title_original || "").slice(0, 120) })),
      unmatched_sample: candidates.filter((c) => !companiesFor(c).length).slice(0, 30).map((c) => ({ via: discoveredVia(c), source: c.source, title: String(c.title || "").slice(0, 120) })),
      process_started: Boolean(shouldProcess && llmReady),
    }, { durationMs: Date.now() - collectStarted });
    if (shouldProcess && llmReady) await chainStage(request, "process", 1, { curate: isCronRequest(request), deep: isCronRequest(request) });
    return response.status(200).json({
      status: shouldProcess && llmReady ? "started" : "ok",
      search_runs: (llmConfig("openai") ? 3 : 0) + (llmConfig("deepseek") ? 3 : 0), discovered: candidates.length, stored: storedArticles.length,
      next_step: shouldProcess && llmReady
        ? "본문 처리와 Daily 생성이 별도 호출로 이어집니다. 몇 분 뒤 첫 화면에 반영됩니다."
        : "process=1 또는 크론이 본문 분석을 시작합니다."
    });
  } catch (error) {
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
