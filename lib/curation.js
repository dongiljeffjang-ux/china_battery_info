import { supabaseRest } from "../api/lib/supabase.js";
import { COMPANIES } from "./china-sources.js";
import { digestReport, redateReportEvents } from "./event-backfill.js";
import { findReport } from "./report-reader.js";
import { embedEvents } from "./vector-ingestion.js";

// 시계열 데이터를 사람 손 없이 채우고 다듬는 유지 작업.
//
// 사용자는 회사만 고르면 되고, 정기보고서를 읽어 사실을 뽑고 시점을 다시 확인하고 벡터에 넣는 일은
// 수집 파이프라인의 마지막 단계가 알아서 한다. 한 번에 다 하지 않고 호출마다 조금씩 하며,
// 어디까지 했는지는 DB(report_digest 장부, occurred_basis, knowledge_chunk)에 남아 있어
// 다음 호출이 이어받는다.

// 보고서 종류별로 "이 안에 읽은 것이 있으면 최신"으로 보는 기간(개월). 연차는 1년에 한 번,
// 반기는 8월 이후, 분기는 4~5월과 10~11월에 나온다.
const FRESH_MONTHS = { annual: 15, semiannual: 8, quarterly: 5 };
// 보고서를 못 찾았을 때 다시 찾아보기까지의 날 수. 매일 거래소를 두드리지 않기 위함이다.
const MISSING_RETRY_DAYS = 14;
const DIGEST_MAX_EVENTS = 8;
const EMBED_BATCH = 60;
const REDATE_BATCH = 20;

const EVENT_SELECT = "id,company_id,article_id,occurred_at,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,company(name_ko)";

function monthsBetween(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

// 지금 계절에 나올 수 있는 보고서 종류. 현행 정보가 먼저이므로 반기·분기를 앞에 둔다.
function seasonKinds(now) {
  const month = now.getUTCMonth() + 1;
  const kinds = [];
  if (month >= 8) kinds.push("semiannual");
  if ([4, 5, 10, 11].includes(month)) kinds.push("quarterly");
  kinds.push("annual");
  return kinds;
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

// 읽어야 할 보고서가 남은 회사 하나를 고른다. 장부에 최신 기록이 있으면 건너뛴다.
export async function pickDueReport(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,report_url,published_at,digested_at");
  for (const kind of seasonKinds(now)) {
    for (const company of COMPANIES) {
      if (!company.cninfo) continue;
      const rows = ledger.filter((row) => row.company_id === company.id && row.kind === kind);
      const fresh = rows.some((row) => {
        if (row.report_url.startsWith("missing:")) {
          return (now - new Date(row.digested_at)) / 86400000 < MISSING_RETRY_DAYS;
        }
        const anchor = new Date(row.published_at || row.digested_at);
        return monthsBetween(anchor, now) < FRESH_MONTHS[kind];
      });
      if (!fresh) return { company, kind };
    }
  }
  return null;
}

// 회사 하나의 보고서 하나를 읽어 이벤트로 넣고 장부에 적는다.
export async function digestCompany(company, kind) {
  const found = await findReport(company, kind);
  if (!found) {
    const stamp = new Date().toISOString().slice(0, 7);
    await supabaseRest("report_digest?on_conflict=company_id,report_url", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { company_id: company.id, kind, report_url: `missing:${kind}:${stamp}`, report_title: null, published_at: null, events_inserted: 0, digested_at: new Date().toISOString() }
    });
    return { status: "missing", company_id: company.id, kind };
  }
  const already = await supabaseRest(`report_digest?select=report_url&company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(found.url)}`);
  if (already.length) return { status: "already", company_id: company.id, kind, url: found.url };

  const { rows, dropped, returned } = await digestReport({ company, kind, knownUrl: found.url, maxEvents: DIGEST_MAX_EVENTS });
  const reportName = `${company.name_ko} ${found.title}`;
  for (const row of rows) row.source_name = reportName;
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
  await supabaseRest("report_digest?on_conflict=company_id,report_url", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { company_id: company.id, kind, report_url: found.url, report_title: found.title, published_at: found.published_at, events_inserted: fresh.length, digested_at: new Date().toISOString() }
  });
  return { status: "digested", company_id: company.id, kind, title: found.title, returned, kept: rows.length, inserted: fresh.length, embedded, dropped };
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
    if (due) log.digest = await digestCompany(due.company, due.kind);
  } catch (error) {
    log.digest = { error: error.message, company_id: due?.company?.id, kind: due?.kind };
    // 읽기에 실패한 보고서는 장부에 남겨 같은 실패를 매일 되풀이하지 않는다.
    if (due) {
      await supabaseRest("report_digest?on_conflict=company_id,report_url", {
        method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
        body: { company_id: due.company.id, kind: due.kind, report_url: `missing:${due.kind}:${new Date().toISOString().slice(0, 7)}:${error.message.slice(0, 40)}`, events_inserted: 0, digested_at: new Date().toISOString() }
      }).catch(() => {});
    }
  }
  if (Date.now() > deadline) return { log, more: true };

  let redate = null;
  try { redate = await redateCompanyBatch(); log.redate = redate; } catch (error) { log.redate = { error: error.message }; }

  const more = Boolean(due) || Boolean(redate && redate.remaining > 0) || Boolean(log.embed && log.embed.remaining > 0);
  return { log, more };
}
