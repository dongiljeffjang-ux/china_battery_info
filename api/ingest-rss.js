import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { requireAccess } from "./lib/access.js";
import { processPendingArticle, recordProcessing } from "./process-article.js";
import { generateDailyReport } from "./generate-daily.js";
import { waitUntil } from "@vercel/functions";
import { runCurationHop } from "../lib/curation.js";
import { COMPANIES, companiesFor, discoverChinaSources } from "../lib/china-sources.js";
import { llmConfig } from "../lib/llm-provider.js";
import { backfillCompanyEvents, digestReport, redateReportEvents } from "../lib/event-backfill.js";
import { embedEvents } from "../lib/vector-ingestion.js";

export const maxDuration = 60;

const TOP10_LIMIT = 10;
const PROCESS_CONCURRENCY = 3;
// 한 함수는 60초 안에 끝나야 한다. 본문 처리는 이 시간까지만 새 기사를 집고 나머지는 다음 호출로 넘긴다.
const STAGE_BUDGET_MS = 42000;
// 본문 처리 호출을 최대 몇 번 이어 붙일지. 하루치 헤드라인 10건이면 두어 번이면 끝난다.
const MAX_PROCESS_HOPS = 4;
// 유지 단계(보고서 읽기·시점 재확인·임베딩) 호출을 하루에 최대 몇 번 이어 붙일지.
const MAX_CURATE_HOPS = 8;
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

function headlineScore(article) {
  const title = (article.title_original || "").toLowerCase();
  const highSignals = HIGH_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const lowSignals = LOW_SIGNAL_TERMS.filter((term) => title.includes(term)).length;
  const ageDays = Math.max(0, (Date.now() - new Date(article.published_at || Date.now()).getTime()) / 86400000);
  return (highSignals * 20) - (lowSignals * 45) + (article.article_company?.length ? 3 : 0) - Math.min(ageDays, 30) / 10;
}

async function selectHeadlineTop10() {
  // 본문을 못 가져온 기사는 다시 집어도 같은 결과다. 한 회차 본문 분석 예산이 열 건뿐이라
  // 죽은 URL이 그 자리를 계속 차지하면 새 기사가 밀린다. body_unavailable과 body_too_short는
  // URL 자체가 쓸모없다는 뜻이므로 제외하고, processing_failed는 일시적 오류일 수 있어 다시 시도한다.
  const rows = await supabaseRest("article?select=id,title_original,source_name,source_tier,published_at,article_company(company_id)&verification_status=eq.pending&or=(processing_status.is.null,processing_status.eq.processing_failed)&order=published_at.desc&limit=500");
  const unique = new Map();
  for (const article of rows) {
    const key = normalizeHeadline(article.title_original);
    if (key && !unique.has(key)) unique.set(key, article);
  }
  return [...unique.values()]
    .filter((article) => article.source_tier.startsWith("web_search_") || article.source_name === "CATL Newsroom")
    .map((article) => ({ ...article, headline_score: headlineScore(article) }))
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
// 각 단계를 별도 호출로 나누고, 앞 단계가 뒷 단계를 HTTP로 부른다. 부름을 받은 쪽은 곧바로
// 응답하고 waitUntil 안에서 일을 계속하므로, 부른 쪽은 기다리지 않고 자기 예산을 다 쓰지 않는다.
// 인증은 크론과 같은 CRON_SECRET을 쓴다. 비밀이 없으면 이어 붙이지 못하므로 그 사실을 남긴다.
function chainStage(request, stage, hop = 1) {
  const secret = process.env.CRON_SECRET;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  if (!secret || !host) {
    console.error("[STAGE_CHAIN_SKIPPED]", JSON.stringify({ stage, reason: !secret ? "no_cron_secret" : "no_host" }));
    return;
  }
  const url = `https://${host}/api/ingest-rss?stage=${encodeURIComponent(stage)}&hop=${hop}`;
  waitUntil(fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } })
    .then((upstream) => console.info("[STAGE_CHAINED]", JSON.stringify({ stage, hop, status: upstream.status })))
    .catch((error) => console.error("[STAGE_CHAIN_FAILED]", JSON.stringify({ stage, hop, message: error.message }))));
}

// 본문 처리 단계. 헤드라인을 골라 예산 안에서 처리하고, 남으면 자신을 다시 부르고, 끝나면 Daily를 부른다.
async function runProcessStage(request, hop) {
  const started = Date.now();
  const selected = await selectHeadlineTop10();
  const results = selected.length ? await processSelectedBatch(selected, started + STAGE_BUDGET_MS) : [];
  const counts = results.reduce((acc, result) => ({ ...acc, [result.status]: (acc[result.status] || 0) + 1 }), {});
  const attempted = new Set(results.map((result) => result.articleId));
  const leftover = selected.filter((article) => !attempted.has(article.id)).length;
  console.info("[PROCESS_STAGE]", JSON.stringify({ hop, selected: selected.length, processed: results.length, leftover, counts, ms: Date.now() - started }));
  if (leftover > 0 && hop < MAX_PROCESS_HOPS) chainStage(request, "process", hop + 1);
  else chainStage(request, "daily");
  await flushTraces();
}

async function runDailyStage(request) {
  const started = Date.now();
  try {
    const report = await generateDailyReport();
    console.info("[DAILY_STAGE]", JSON.stringify({ status: report.status, top10: report.top10_count || 0, ms: Date.now() - started }));
  } catch (error) {
    console.error("[DAILY_STAGE_FAILED]", JSON.stringify({ message: error.message }));
  }
  // Daily가 끝나면 시계열 유지 작업으로 넘어간다. 사용자가 버튼을 누르지 않아도 보고서가 읽히고 시점이 다듬어진다.
  chainStage(request, "curate", 1);
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
  } catch (error) {
    console.error("[CURATE_STAGE_FAILED]", JSON.stringify({ hop, message: error.message }));
  }
  if (more && hop < MAX_CURATE_HOPS) chainStage(request, "curate", hop + 1);
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
  // 정기보고서 원문을 읽어 시계열을 채운다. kind는 annual(과거)·semiannual·quarterly(현행).
  const digestCompanyId = String(request.query?.digest || request.body?.digest || "").trim();
  if (digestCompanyId) {
    const requested = String(request.query?.kind || request.body?.kind || "annual").trim();
    const kind = ["annual", "semiannual", "quarterly"].includes(requested) ? requested : "annual";
    return runBackfill(response, digestCompanyId, null, kind);
  }
  const redateCompanyId = String(request.query?.redate || request.body?.redate || "").trim();
  if (redateCompanyId) return runRedate(response, redateCompanyId);
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
        verification_status: "pending", source_tier: candidate.kind === "disclosure" ? "official_disclosure" : candidate.kind === "web_search_news" ? `web_search_${candidate.searchProvider || "discovered"}` : "needs_review"
    }));
    stage = "article_storage";
    const storedArticles = articleRows.length
      ? await supabaseRest("article?on_conflict=canonical_url", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: articleRows })
      : [];
    const idByUrl = new Map(storedArticles.map((article) => [article.canonical_url, article.id]));
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
    if (shouldProcess && llmReady) chainStage(request, "process", 1);
    return response.status(200).json({
      status: shouldProcess && llmReady ? "started" : "ok",
      search_runs: (llmConfig("openai") ? 3 : 0) + (llmConfig("deepseek") ? 3 : 0), discovered: candidates.length, stored: storedArticles.length,
      next_step: shouldProcess && llmReady
        ? "본문 처리와 Daily 생성이 별도 호출로 이어집니다. 몇 분 뒤 첫 화면에 반영됩니다."
        : "process=1 또는 크론이 본문 분석을 시작합니다."
    });
  } catch (error) {
    console.error("[INGESTION_FAILED]", JSON.stringify({ stage, message: error.message }));
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
