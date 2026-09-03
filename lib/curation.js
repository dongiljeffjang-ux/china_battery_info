import { supabaseRest } from "../api/lib/supabase.js";
import { COMPANIES } from "./china-sources.js";
import { digestReport, redateReportEvents, backfillCompanyEvents } from "./event-backfill.js";
import { findReports } from "./report-reader.js";
import { embedEvents } from "./vector-ingestion.js";

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
const DIGEST_MAX_EVENTS = 8;
const EMBED_BATCH = 60;
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

// 커버리지 계획 가운데 장부에 없는 (회사, 창) 하나를 고른다.
export async function pickDueReport(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,report_url,published_at,digested_at");
  for (const window of coverageWindows(now)) {
    for (const company of COMPANIES) {
      if (!company.cninfo) continue;
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
export async function pickDueWebBackfill(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,digested_at&kind=eq.web");
  for (const company of COMPANIES) {
    if (company.cninfo) continue;
    const last = ledger.filter((row) => row.company_id === company.id).sort((a, b) => b.digested_at.localeCompare(a.digested_at))[0];
    if (last && (now - new Date(last.digested_at)) / 86400000 < WEB_REFRESH_DAYS) continue;
    return company;
  }
  return null;
}

async function storeEvents(company, rows) {
  const existing = await supabaseRest(`event?select=occurred_at,title_ko&company_id=eq.${encodeURIComponent(company.id)}`);
  const key = (row) => JSON.stringify([row.occurred_at, row.title_ko]);
  const seen = new Set(existing.map(key));
  const fresh = rows.filter((row) => !seen.has(key(row)));
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
  await writeLedger({ company_id: company.id, kind, report_url: found.url, report_title: found.title, published_at: found.published_at, events_inserted: inserted });
  return { status: "digested", company_id: company.id, kind, fiscal: window?.fiscal, title: found.title, returned, kept: rows.length, inserted, embedded, dropped };
}

export async function webBackfillCompany(company) {
  const until = new Date().toISOString().slice(0, 10);
  const { rows, dropped, returned } = await backfillCompanyEvents({ company, since: WEB_BACKFILL_SINCE, until, maxEvents: 12 });
  const { inserted, embedded } = await storeEvents(company, rows);
  await writeLedger({ company_id: company.id, kind: "web", report_url: `web:${until}`, report_title: `웹 백필 ${WEB_BACKFILL_SINCE}~${until}`, events_inserted: inserted });
  return { status: "web_backfilled", company_id: company.id, returned, kept: rows.length, inserted, embedded, dropped };
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
      if (web) log.web = await webBackfillCompany(web);
    } catch (error) {
      log.web = { error: error.message, company_id: web?.id };
      if (web) await writeLedger({ company_id: web.id, kind: "web", report_url: `web:failed:${new Date().toISOString().slice(0, 10)}` }).catch(() => {});
    }
    if (Date.now() > deadline) return { log, more: true };
  }

  let redate = null;
  try { redate = await redateCompanyBatch(); log.redate = redate; } catch (error) { log.redate = { error: error.message }; }

  const more = Boolean(due) || Boolean(web) || Boolean(redate && redate.remaining > 0) || Boolean(log.embed && log.embed.remaining > 0);
  return { log, more };
}
