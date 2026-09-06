import { supabaseRest } from "../api/lib/supabase.js";
import { COMPANIES } from "./china-sources.js";
import { digestReport, redateReportEvents, backfillCompanyEvents } from "./event-backfill.js";
import { findReports } from "./report-reader.js";
import { embedEvents, embedVerifiedArticle } from "./vector-ingestion.js";
import { embedPendingHeadlines } from "./headline-knowledge.js";
import { extractMissingConcepts } from "./concept-graph.js";

// 시계열 데이터를 사람 손 없이 채우고 다듬는 유지 작업.
//
// 사용자는 회사만 고르면 되고, 정기보고서를 읽어 사실을 뽑고 시점을 다시 확인하고 벡터에 넣는 일은
// 수집 파이프라인의 마지막 단계가 알아서 한다. 한 번에 다 하지 않고 호출마다 조금씩 하며,
// 어디까지 했는지는 DB(report_digest 장부, occurred_basis, knowledge_chunk)에 남아 있어
// 다음 호출이 이어받는다.

// 회사마다 최근 3년이 시계열에 들어가 있어야 한다. 그래서 "최신 보고서 한 건"이 아니라
// 회계연도별로 읽어야 할 보고서 목록(커버리지 계획)을 만들고, 장부에 없는 것부터 채운다.
//   연차: 최근 3개 회계연도(발행은 이듬해 1~6월)
//   반기: 최근 3년의 상반기(발행은 그해 7~10월, 올해는 8월 이후에만)
// 분기보고서는 건수가 많고 담기는 사실이 적어 계획에 넣지 않는다.
const COVERAGE_YEARS = 3;
// 보고서를 못 찾았을 때 다시 찾아보기까지의 날 수. 매일 거래소를 두드리지 않기 위함이다.
const MISSING_RETRY_DAYS = 14;
// 비상장사 웹 백필을 다시 돌리기까지의 날 수.
const WEB_REFRESH_DAYS = 90;
// 상장사 "올해분" 웹 백필을 다시 돌리기까지의 날 수. 아직 보고서가 안 나온 최신 소식이라 더 자주 갱신한다.
const CURRENT_YEAR_REFRESH_DAYS = 30;
// 청크(1.2만 자)마다 이만큼까지. 8이었을 때 보고서 한 건에서 1~3건만 남아 시계열이 비어 보였다.
const DIGEST_MAX_EVENTS = 14;
// 보강 패스: 옛 규칙(핵심만·8건)으로 읽은 보고서를 새 규칙으로 다시 읽는다. 훅마다 이만큼.
const ENRICH_PER_HOP = 3;
const EMBED_BATCH = 60;
// 임베딩이 실패했거나 빠진 기사를 훅마다 이만큼 다시 시도한다. 기사 한 건이 청크 여러 개라 적게 잡는다.
const ARTICLE_EMBED_BATCH = 5;
// 한 기사를 몇 번까지 다시 시도할지. 영구 실패(본문이 이상하거나 API가 계속 거절)를 매 훅마다
// 다시 집으면 밤새 헛돌며 임베딩 호출만 태운다. 이 횟수를 넘기면 더 집지 않는다.
const ARTICLE_EMBED_MAX_ATTEMPTS = 3;
const REDATE_BATCH = 20;
const WEB_BACKFILL_SINCE = "2023-01-01";

const EVENT_SELECT = "id,company_id,article_id,occurred_at,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,company(name_ko)";

// 읽어야 할 보고서 창 목록. 현행 정보가 먼저이므로 최근 반기부터 과거 연차 순으로 둔다.
function coverageWindows(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const windows = [];
  // 연차는 결산 3개년(작년·재작년·그 전해), 반기는 올해(8월 이후)·작년·재작년. 그래야 "최근 3년"이
  // 2023~2025 결산을 모두 덮는다. 전에는 back<3에서 연차가 두 해만 잡혀 2023년이 통째로 비어 있었다.
  for (let back = 0; back <= COVERAGE_YEARS; back += 1) {
    const fiscal = year - back;
    // 그해 반기보고서는 8월 이후에야 나온다.
    if (back < COVERAGE_YEARS && (back > 0 || month >= 8)) windows.push({ kind: "semiannual", fiscal, from: `${fiscal}-07-01`, to: `${fiscal}-11-30` });
    // 그해 연차보고서는 이듬해 상반기에 나온다. 올해 결산분은 아직 없다.
    if (back > 0) windows.push({ kind: "annual", fiscal, from: `${fiscal + 1}-01-01`, to: `${fiscal + 1}-07-31` });
  }
  // 최근 것부터: 반기(올해) → 연차(작년) → 반기(작년) → …
  return windows.sort((a, b) => b.from.localeCompare(a.from));
}

function windowTag(window) {
  return `missing:${window.kind}:${window.fiscal}`;
}

// 아직 벡터에 없는 이벤트를 임베딩한다. 기사 처리 중 임베딩이 실패한 것과 예전 이벤트를 메운다.
export async function embedMissingEvents(limit = EMBED_BATCH) {
  const embedded = await supabaseRest("knowledge_chunk?select=event_id&event_id=not.is.null");
  const done = new Set(embedded.map((row) => row.event_id));
  const all = await supabaseRest(`event?select=${EVENT_SELECT}&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=500`);
  const pending = all.filter((event) => !done.has(event.id));
  const batch = pending.slice(0, limit).map((event) => ({ ...event, company_name_ko: event.company?.name_ko || null }));
  if (!batch.length) return { embedded: 0, remaining: 0 };
  const result = await embedEvents(batch);
  return { embedded: result.chunks, remaining: Math.max(pending.length - batch.length, 0) };
}

// 본문 검증을 통과했는데 벡터에 들어가지 못한 기사를 다시 임베딩한다.
//
// 임베딩은 기사 처리 마지막에 한 번 시도하고, 실패하면 embedding_status만 failed로 적고 넘어간다.
// 그 뒤 아무도 다시 집지 않아 그 기사는 영영 검색에 안 걸렸다. 처리 도중 함수가 끊겨
// pending으로 남은 것도 마찬가지다. 팩트체크에서 떨어진 기사(rejected)는 대상이 아니다.
export async function embedMissingArticles(limit = ARTICLE_EMBED_BATCH) {
  const rows = await supabaseRest(
    "article?select=id,title_original,title_ko,summary_ko,body_original,canonical_url,source_name,published_at,embedding_attempts,article_company(company_id)"
    + "&verification_status=eq.pending_review&embedding_status=neq.embedded&body_original=not.is.null"
    + `&embedding_attempts=lt.${ARTICLE_EMBED_MAX_ATTEMPTS}`
    + `&order=published_at.desc&limit=${limit}`
  );
  if (!rows.length) return { embedded: 0, articles: 0, failed: 0 };
  let embedded = 0;
  let failed = 0;
  for (const article of rows) {
    try {
      const result = await embedVerifiedArticle({
        article,
        companyId: article.article_company?.[0]?.company_id || null,
        bodyText: article.body_original,
        titleKo: article.title_ko,
        summaryKo: article.summary_ko,
        sourceUrl: article.canonical_url,
        sourceName: article.source_name,
        publishedAt: article.published_at,
      });
      embedded += result.chunks;
    } catch (error) {
      failed += 1;
      // 시도 횟수를 올려 둔다. 상한에 닿으면 다음부터 이 기사는 아예 조회되지 않는다.
      const attempts = (article.embedding_attempts || 0) + 1;
      console.error("[ARTICLE_EMBED_RETRY_FAILED]", JSON.stringify({ articleId: article.id, attempts, giveUp: attempts >= ARTICLE_EMBED_MAX_ATTEMPTS, message: error.message }));
      await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
        method: "PATCH", prefer: "return=minimal",
        body: { embedding_status: "failed", embedding_attempts: attempts, updated_at: new Date().toISOString() },
      }).catch(() => {});
    }
  }
  return { embedded, articles: rows.length, failed };
}

// 커버리지 계획 가운데 장부에 없는 (회사, 창) 하나를 고른다.
export async function pickDueReport(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,report_url,published_at,digested_at");
  for (const window of coverageWindows(now)) {
    for (const company of COMPANIES) {
      // 심천·상해(cninfo)와 홍콩(hkex) 상장사만 정기보고서가 있다.
      if (!company.cninfo && !company.hkex) continue;
      const rows = ledger.filter((row) => row.company_id === company.id && row.kind === window.kind);
      const covered = rows.some((row) => row.published_at && row.published_at >= window.from && row.published_at <= window.to);
      if (covered) continue;
      const missing = rows.find((row) => row.report_url.startsWith(windowTag(window)));
      if (missing && (now - new Date(missing.digested_at)) / 86400000 < MISSING_RETRY_DAYS) continue;
      return { company, kind: window.kind, window };
    }
  }
  return null;
}

// 비상장사는 공시가 없다. 웹 검색 백필로 최근 3년을 채우되 참고 등급으로만 둔다.
// 한 번에 3년치를 12건으로 뽑으면 너무 얇아서, (회사, 연도) 단위로 나눠 연도마다 따로 검색한다.
//
// 상장사는 과거 연도가 이미 연차·반기보고서로 확정돼 있으니 그 연도는 건드리지 않는다. 다만
// "올해"는 다음 반기·연차보고서가 나오기 전까지 공백이 생기므로, 최신성이 중요한 최근 소식만
// 뉴스·기사로 보충한다(참고 등급). 과거 연도와 갱신 주기를 다르게 둬 최신 소식이 더 자주 새로 돈다.
export async function pickDueWebBackfill(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,report_url,digested_at&kind=eq.web");
  const currentYear = now.getUTCFullYear();
  const pastYears = [];
  for (let year = Number(WEB_BACKFILL_SINCE.slice(0, 4)); year <= currentYear; year += 1) pastYears.push(year);
  for (const company of COMPANIES) {
    const listed = Boolean(company.cninfo || company.hkex);
    const candidateYears = listed ? [currentYear] : pastYears.slice().reverse();
    const refreshDays = listed ? CURRENT_YEAR_REFRESH_DAYS : WEB_REFRESH_DAYS;
    for (const year of candidateYears) {
      const last = ledger.filter((row) => row.company_id === company.id && row.report_url.startsWith(`web:${year}:`)).sort((a, b) => b.digested_at.localeCompare(a.digested_at))[0];
      if (last && (now - new Date(last.digested_at)) / 86400000 < refreshDays) continue;
      return { company, year, listed };
    }
  }
  return null;
}

// 같은 보고서를 두 번 읽으면 모델이 제목을 조금씩 다르게 붙인다. 제목을 정규화해 비교하고,
// 같은 날짜에 같은 숫자들이 들어 있으면 같은 사실로 본다.
function normalizeTitle(title) {
  return String(title || "").toLowerCase().replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff]/g, "");
}
function numbersOf(text) {
  return new Set((String(text || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).filter((n) => n.length >= 2));
}
export function sameFact(a, b) {
  const ta = normalizeTitle(a.title_ko), tb = normalizeTitle(b.title_ko);
  if (ta && ta === tb) return true;
  if (ta.length >= 10 && tb.length >= 10 && (ta.includes(tb) || tb.includes(ta))) return true;
  if (a.occurred_at !== b.occurred_at) return false;
  const na = numbersOf(`${a.title_ko} ${a.fact_ko}`), nb = numbersOf(`${b.title_ko} ${b.fact_ko}`);
  if (na.size < 2 || nb.size < 2) return false;
  let shared = 0;
  for (const n of na) if (nb.has(n)) shared += 1;
  return shared / Math.min(na.size, nb.size) >= 0.7;
}

async function storeEvents(company, rows) {
  const existing = await supabaseRest(`event?select=occurred_at,title_ko,fact_ko&company_id=eq.${encodeURIComponent(company.id)}`);
  const fresh = [];
  for (const row of rows) {
    if (existing.some((prev) => sameFact(prev, row)) || fresh.some((prev) => sameFact(prev, row))) continue;
    fresh.push(row);
  }
  let embedded = 0;
  if (fresh.length) {
    const stored = await supabaseRest("event", { method: "POST", prefer: "return=representation", body: fresh });
    try {
      embedded = (await embedEvents((stored || []).map((row) => ({ ...row, company_name_ko: company.name_ko })))).chunks;
    } catch (error) {
      console.error("[CURATE_EMBED_FAILED]", JSON.stringify({ companyId: company.id, message: error.message }));
    }
  }
  return { inserted: fresh.length, embedded };
}

async function writeLedger(row) {
  await supabaseRest("report_digest?on_conflict=company_id,report_url", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { events_inserted: 0, digested_at: new Date().toISOString(), ...row }
  });
}

// 회사 하나의 특정 창에 해당하는 보고서를 읽어 이벤트로 넣고 장부에 적는다.
export async function digestCompany(company, kind, window) {
  const candidates = await findReports(company, kind, { years: COVERAGE_YEARS + 1.7 });
  const found = window
    ? candidates.find((item) => item.published_at >= window.from && item.published_at <= window.to)
    : candidates[0];
  if (!found) {
    await writeLedger({ company_id: company.id, kind, report_url: window ? windowTag(window) : `missing:${kind}:${new Date().toISOString().slice(0, 7)}` });
    return { status: "missing", company_id: company.id, kind, fiscal: window?.fiscal };
  }
  const already = await supabaseRest(`report_digest?select=report_url&company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(found.url)}`);
  if (already.length) return { status: "already", company_id: company.id, kind, url: found.url };

  const { rows, dropped, returned } = await digestReport({ company, kind, knownUrl: found.url, maxEvents: DIGEST_MAX_EVENTS });
  const reportName = `${company.name_ko} ${found.title}`;
  for (const row of rows) row.source_name = reportName;
  const { inserted, embedded } = await storeEvents(company, rows);
  await writeLedger({ company_id: company.id, kind, report_url: found.url, report_title: found.title, published_at: found.published_at, events_inserted: inserted, enriched_at: new Date().toISOString() });
  return { status: "digested", company_id: company.id, kind, fiscal: window?.fiscal, title: found.title, returned, kept: rows.length, inserted, embedded, dropped };
}

// 보강 패스. 옛 규칙으로 읽어 사실이 적게 남은 보고서부터 새 규칙으로 다시 읽고, 새로 나온 사실만 더한다.
export async function pickThinReport() {
  const rows = await supabaseRest("report_digest?select=company_id,kind,report_url,report_title,events_inserted&enriched_at=is.null&kind=in.(annual,semiannual)&order=events_inserted.asc,published_at.desc&limit=50");
  return rows.find((row) => !row.report_url.startsWith("missing:") && !row.report_url.startsWith("web:")) || null;
}

export async function enrichReport(row) {
  const company = COMPANIES.find((item) => item.id === row.company_id);
  if (!company) return { status: "unknown_company", company_id: row.company_id };
  const { rows, dropped, returned } = await digestReport({ company, kind: row.kind, knownUrl: row.report_url, maxEvents: DIGEST_MAX_EVENTS });
  const reportName = `${company.name_ko} ${row.report_title || ""}`.trim();
  for (const item of rows) item.source_name = reportName;
  const { inserted, embedded } = await storeEvents(company, rows);
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(row.report_url)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: { enriched_at: new Date().toISOString(), events_inserted: (row.events_inserted || 0) + inserted },
  });
  return { status: "enriched", company_id: company.id, kind: row.kind, title: row.report_title, before: row.events_inserted, returned, kept: rows.length, inserted, embedded, dropped };
}

export async function webBackfillCompany(company, year) {
  const today = new Date().toISOString().slice(0, 10);
  let since = `${year}-01-01`;
  // 상장사는 그 연도에 이미 읽은 반기·연차보고서가 있으면 그 보고 기간 이후만 웹으로 보충한다.
  // 보고서로 이미 확정된 기간과 겹쳐 같은 사실을 두 번 만들지 않기 위함이다.
  if (company.cninfo || company.hkex) {
    const covered = await supabaseRest(`report_digest?select=published_at&company_id=eq.${encodeURIComponent(company.id)}&kind=in.(annual,semiannual)&published_at=not.is.null&order=published_at.desc&limit=1`);
    const lastPublished = covered[0]?.published_at;
    if (lastPublished && lastPublished > since) since = lastPublished;
  }
  const until = `${year}-12-31` < today ? `${year}-12-31` : today;
  if (since >= until) {
    // 최근 보고서가 이미 오늘 근처까지 덮고 있어 보충할 공백이 없다.
    await writeLedger({ company_id: company.id, kind: "web", report_url: `web:${year}:${today}`, report_title: `웹 백필 건너뜀(보고서가 최신)`, events_inserted: 0 });
    return { status: "skipped_no_gap", company_id: company.id, year, since, until };
  }
  const { rows, dropped, returned } = await backfillCompanyEvents({ company, since, until, maxEvents: 10 });
  const { inserted, embedded } = await storeEvents(company, rows);
  await writeLedger({ company_id: company.id, kind: "web", report_url: `web:${year}:${today}`, report_title: `웹 백필 ${since}~${until}`, events_inserted: inserted });
  return { status: "web_backfilled", company_id: company.id, year, returned, kept: rows.length, inserted, embedded, dropped };
}

// 시점을 아직 확인하지 않은 연차보고서 이벤트를 회사 하나 분량 처리한다.
export async function redateCompanyBatch() {
  const pending = await supabaseRest(`event?select=id,company_id,occurred_at,title_ko,fact_ko&evidence_kind=eq.annual_report&occurred_basis=is.null&order=company_id.asc,occurred_at.asc&limit=200`);
  if (!pending.length) return { status: "done", checked: 0, changed: 0, remaining: 0 };
  const companyId = pending[0].company_id;
  const company = COMPANIES.find((item) => item.id === companyId);
  const events = pending.filter((event) => event.company_id === companyId).slice(0, REDATE_BATCH);
  if (!company) return { status: "unknown_company", company_id: companyId, remaining: pending.length };
  const { items, checked } = await redateReportEvents({ company, events });
  let changed = 0;
  for (const item of items) {
    await supabaseRest(`event?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH", body: { occurred_at: item.occurred_at, occurred_precision: item.occurred_precision, occurred_basis: item.occurred_basis }
    });
    if (item.changed) changed += 1;
  }
  if (items.length) {
    try {
      const updated = await supabaseRest(`event?select=*&id=in.(${items.map((item) => item.id).join(",")})`);
      await embedEvents((updated || []).map((row) => ({ ...row, company_name_ko: company.name_ko })));
    } catch (error) {
      console.error("[CURATE_REDATE_EMBED_FAILED]", JSON.stringify({ companyId, message: error.message }));
    }
  }
  return { status: "redated", company_id: companyId, checked, changed, remaining: pending.length - items.length };
}

// 한 호출 분량의 유지 작업. 예산이 다하면 남은 일은 다음 호출로 넘긴다.
export async function runCurationHop({ deadline }) {
  const log = {};
  try { log.embed = await embedMissingEvents(); } catch (error) { log.embed = { error: error.message }; }
  if (Date.now() > deadline) return { log, more: true };

  try { log.embed_article = await embedMissingArticles(); } catch (error) { log.embed_article = { error: error.message }; }
  if (Date.now() > deadline) return { log, more: true };

  // 본문을 읽지 않은 수집 기사도 제목만 번역해 벡터 지식에 넣는다. 검증본과 등급을 나눠 저장한다.
  try { log.embed_headline = await embedPendingHeadlines({ deadline }); } catch (error) { log.embed_headline = { error: error.message }; }
  if (Date.now() > deadline) return { log, more: true };

  // 개념어 관계(지식그래프) 추출. 비교 리포트가 회사 간 개념 겹침·선후관계를 짚을 근거가 된다.
  try { log.concepts = await extractMissingConcepts({ deadline }); } catch (error) { log.concepts = { error: error.message }; }
  if (Date.now() > deadline) return { log, more: true };

  let due = null;
  try {
    due = await pickDueReport();
    if (due) log.digest = await digestCompany(due.company, due.kind, due.window);
  } catch (error) {
    log.digest = { error: error.message, company_id: due?.company?.id, kind: due?.kind, fiscal: due?.window?.fiscal };
    // 읽기에 실패한 보고서는 장부에 남겨 같은 실패를 매일 되풀이하지 않는다.
    if (due) await writeLedger({ company_id: due.company.id, kind: due.kind, report_url: `${windowTag(due.window)}:${error.message.slice(0, 40)}` }).catch(() => {});
  }
  if (Date.now() > deadline) return { log, more: true };

  let web = null;
  if (!due) {
    try {
      web = await pickDueWebBackfill();
      if (web) log.web = await webBackfillCompany(web.company, web.year);
    } catch (error) {
      log.web = { error: error.message, company_id: web?.company?.id, year: web?.year };
      if (web) await writeLedger({ company_id: web.company.id, kind: "web", report_url: `web:${web.year}:failed:${new Date().toISOString().slice(0, 10)}` }).catch(() => {});
    }
    if (Date.now() > deadline) return { log, more: true };
  }

  // 보강 패스. 예산이 남는 동안 얇은 보고서부터 몇 건 다시 읽는다.
  const enriched = [];
  let thinLeft = false;
  for (let i = 0; i < ENRICH_PER_HOP && Date.now() < deadline; i += 1) {
    let thin = null;
    try {
      thin = await pickThinReport();
      if (!thin) break;
      enriched.push(await enrichReport(thin));
    } catch (error) {
      enriched.push({ error: error.message, company_id: thin?.company_id, title: thin?.report_title });
      // 실패해도 표시해 두어 같은 보고서에서 매번 멈추지 않게 한다.
      if (thin) await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(thin.company_id)}&report_url=eq.${encodeURIComponent(thin.report_url)}`, { method: "PATCH", prefer: "return=minimal", body: { enriched_at: new Date().toISOString() } }).catch(() => {});
    }
    thinLeft = true;
  }
  if (enriched.length) log.enrich = enriched;
  if (Date.now() > deadline) return { log, more: true };

  let redate = null;
  try { redate = await redateCompanyBatch(); log.redate = redate; } catch (error) { log.redate = { error: error.message }; }

  const more = Boolean(due) || Boolean(web) || thinLeft || Boolean(redate && redate.remaining > 0)
    || Boolean(log.embed && log.embed.remaining > 0)
    || Boolean(log.embed_article && log.embed_article.articles >= ARTICLE_EMBED_BATCH)
    || Boolean(log.embed_headline && log.embed_headline.remaining > 0)
    || Boolean(log.concepts && log.concepts.remaining > 0);
  return { log, more };
}
