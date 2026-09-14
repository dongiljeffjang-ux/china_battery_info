import { supabaseRest } from "./supabase.js";
import { COMPANIES, TRACKED_COMPANIES } from "./china-sources.js";
import { digestReport, backfillCompanyEvents } from "./event-backfill.js";
import { findReports, readReport } from "./report-reader.js";
import { embedEvents, embedVerifiedArticle, embedReportChunks } from "./vector-ingestion.js";
import { redateArticleEvents } from "./event-backfill.js";
import { embedPendingHeadlines } from "./headline-knowledge.js";
import { extractMissingConcepts } from "./concept-graph.js";
import { extractMissingFacts } from "./fact-extraction.js";

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
// 청크(원문 12,000자) 하나에서 뽑을 사실 수 상한. 14는 실제로 걸리고 있었다 —
// Farasis 2026 반기가 52건(4청크 × 14 = 56)으로 상한의 93%, Zhenhua 반기가 25/28로 89%였다.
// "한 건에는 같은 문장의 수치만" 규칙으로 건수가 2배 안팎 늘어나므로 상한도 함께 올린다.
// 올리지 않으면 쪼갠 만큼 뒤쪽 사실이 잘려 나간다.
const DIGEST_MAX_EVENTS = 30;
// 보고서 읽기 LLM 호출 상한. 조각당 사실 14건에 원문 발췌·번역이 붙어 출력이 길고, 45초 기본값으로는
// 정상 완료될 호출이 timeout으로 끊겼다(2026-09-07 룽바이 반기보고서 보강). 훅 예산(90초) 안에 둔다.
const REPORT_LLM_TIMEOUT_MS = 85000;
// 웹 백필 검색 호출 상한. 기본 35초로는 CATL처럼 결과가 많은 회사가 끊겼다.
const WEB_LLM_TIMEOUT_MS = 60000;
// 시간 초과는 보고서나 회사의 문제가 아니라 그때 호출이 느렸던 것이다. 실패로 못 박아 영영 건너뛰지
// 않고 다음 순환에서 다시 집는다. 그 밖의 오류(원문 없음·형식 깨짐)는 예전처럼 기록하고 넘어간다.
function isTimeoutError(error) {
  return /timeout|abort/i.test(String(error?.name || "")) || /aborted due to timeout|TimeoutError/i.test(String(error?.message || ""));
}
const EMBED_BATCH = 60;
// 임베딩이 실패했거나 빠진 기사를 훅마다 이만큼 다시 시도한다. 기사 한 건이 청크 여러 개라 적게 잡는다.
const ARTICLE_EMBED_BATCH = 5;
// 한 기사를 몇 번까지 다시 시도할지. 영구 실패(본문이 이상하거나 API가 계속 거절)를 매 훅마다
// 다시 집으면 밤새 헛돌며 임베딩 호출만 태운다. 이 횟수를 넘기면 더 집지 않는다.
const ARTICLE_EMBED_MAX_ATTEMPTS = 3;
// 보고서 원문을 벡터에 넣는 작업의 훅당 상한. 실제로 몇 건을 하느냐는 이 수가 아니라 남은 훅 예산이
// 정한다. 예전에는 1건으로 못박아 하룻밤에 4건(훅 40회 ÷ 무거운 단계 10종)밖에 못 넣었고, 대기 107건을
// 채우는 데 한 달이 걸렸다. 한 건의 소요는 본문이 장부에 있느냐(임베딩만)와 없느냐(PDF 재다운로드·파싱)에
// 따라 크게 흔들려 건수로는 예산을 맞출 수 없다. 그래서 시간으로 끊고, 이 수는 폭주 방지용 상한으로만 둔다.
const REPORT_EMBED_BATCH = 8;
// 보고서 한 건에 남겨 둘 최소 예산. 남은 시간이 이보다 적으면 새 보고서를 열지 않는다.
// 열어 놓고 함수가 끊기면 PDF를 받아 놓고 버리는 셈이라 다음 훅이 같은 일을 처음부터 다시 한다.
const REPORT_EMBED_RESERVE_MS = 30000;
const REPORT_TEXT_ONLY_EMBEDDING = process.env.REPORT_TEXT_ONLY_EMBEDDING === "1";
const WEB_BACKFILL_SINCE = "2023-01-01";

const EVENT_SELECT = "id,company_id,article_id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,event_fact(counterparty),company(name_ko)";

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

// 임베딩 백로그는 "knowledge_chunk에 event_id가 없는 event"로 구한다. 예전에는 최근 500건만
// 조회해, 그보다 오래된 이벤트가 청크를 잃으면 영원히 백로그에 잡히지 않았다(2026-09-07 확인:
// 567~582위 이벤트 7건이 이 사각지대에 있었다). 전체를 페이지로 훑는다.
export async function fetchEmbeddableEvents(select, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseRest(`event?select=${select}&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=${pageSize}&offset=${offset}`);
    rows.push(...(page || []));
    if (!page || page.length < pageSize) return rows;
  }
}

// 아직 벡터에 없는 이벤트를 임베딩한다. 기사 처리 중 임베딩이 실패한 것과 예전 이벤트를 메운다.
export async function embedMissingEvents(limit = EMBED_BATCH) {
  const embedded = await supabaseRest("knowledge_chunk?select=event_id&event_id=not.is.null");
  const done = new Set(embedded.map((row) => row.event_id));
  const all = await fetchEmbeddableEvents(EVENT_SELECT);
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
    + "&verification_status=eq.verified&embedding_status=neq.embedded&body_original=not.is.null"
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
      const giveUp = attempts >= ARTICLE_EMBED_MAX_ATTEMPTS;
      console.error("[ARTICLE_EMBED_RETRY_FAILED]", JSON.stringify({ articleId: article.id, attempts, giveUp, message: error.message }));
      await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
        method: "PATCH", prefer: "return=minimal",
        // 상한에 닿으면 이 기사는 다시 조회되지 않는다. 원문을 들고 있을 이유가 사라지므로 지운다.
        // 이 경로는 언론 기사 재임베딩 전용이라 공시는 오지 않는다.
        body: { embedding_status: "failed", embedding_attempts: attempts, updated_at: new Date().toISOString(), ...(giveUp ? { body_original: null } : {}) },
      }).catch(() => {});
    }
  }
  return { embedded, articles: rows.length, failed };
}

// 정기보고서 원문을 벡터에 넣는다.
//
// 보고서는 사실 몇 줄만 뽑고 본문을 버려 왔다. 226쪽 연차보고서에서 14줄만 남으니 그 밖의
// 내용은 검색으로 찾을 수 없었다. 거래소에 공개된 자료라 보관·색인에 문제가 없다.
// 원문 전체를 넣는다. 본문이 비어 있는 장부(예전에 읽은 보고서)는 그때만 PDF를 다시 내려받아 채운다.
// 큰 보고서는 한 훅에 다 못 넣으므로 장부의 embedded_chunks/embedded_total로 진행을 기록하고 이어 간다.
// deadline은 훅 예산의 끝 시각이다. 다른 무거운 단계와 달리 이 단계는 예전에 예산을 받지 않아,
// 한 건을 끝낼 때까지 무조건 돌았다. 이제 남은 시간을 보고 한 훅에서 여러 건을 이어 처리한다.
export async function embedMissingReports({ deadline = Infinity, limit = REPORT_EMBED_BATCH } = {}) {
  if (!REPORT_TEXT_ONLY_EMBEDDING) return { embedded: 0, reports: 0, remaining: 0, status: "paused_visual_audit" };
  const ledger = await supabaseRest(
    "report_digest?select=company_id,kind,report_url,report_title,published_at,body_original,body_section,body_chars,embedded_chunks,embedded_total"
    + "&kind=in.(annual,semiannual)&order=published_at.desc&limit=400"
  );
  const pending = (ledger || []).filter((row) =>
    !row.report_url.startsWith("missing:") && !row.report_url.startsWith("web:")
    && (row.embedded_total == null || (row.embedded_chunks || 0) < row.embedded_total));
  if (!pending.length) return { embedded: 0, reports: 0, remaining: 0 };
  let embedded = 0;
  let reports = 0;
  let opened = 0;
  for (const row of pending.slice(0, limit)) {
    // 남은 예산이 한 건을 감당하지 못하면 여기서 멈춘다. 다음 훅이 이어받는다.
    if (Date.now() + REPORT_EMBED_RESERVE_MS > deadline) break;
    const company = COMPANIES.find((item) => item.id === row.company_id);
    if (!company) continue;
    opened += 1;
    const where = `report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(row.report_url)}`;
    try {
      let text = row.body_original;
      let section = row.body_section;
      // 이번 훅에서 PDF를 다시 읽었을 때만 채워진다. 아래 품질 PATCH가 이것을 본다.
      let report = null;
      if (!text) {
        // 예전에 읽은 보고서라 본문이 없다. 이번에 다시 내려받아 장부에도 채운다.
        report = await readReport(company, { kind: row.kind, knownUrl: row.report_url });
        text = report.text;
        section = report.section;
        await supabaseRest(where, {
          method: "PATCH", prefer: "return=minimal",
          body: { body_original: report.text, body_section: report.section, body_chars: report.text.length },
        }).catch(() => {});
      }
      const result = await embedReportChunks({
        companyId: company.id, companyNameKo: company.name_ko,
        reportUrl: row.report_url, reportTitle: row.report_title, publishedAt: row.published_at, section, text,
      });
      embedded += result.chunks;
      reports += 1;
      // 진행을 장부에 적는다. 조각이 0이면 총량도 0으로 적어 같은 보고서를 매 훅마다 다시 열지 않는다.
      await supabaseRest(where, {
        method: "PATCH", prefer: "return=minimal",
        body: { embedded_chunks: (row.embedded_chunks || 0) + result.chunks, embedded_total: result.total ?? 0 },
      }).catch(() => {});
      // 품질 메타데이터는 이번 훅에서 PDF를 읽었을 때만 적는다. 예전에는 report를 if 블록 안에서
      // const로 선언해 놓고 여기서 참조해, 이 줄이 늘 ReferenceError를 던졌다. 청크 적재와 진행
      // 기록은 그 앞에서 끝나 데이터는 남았지만, 매 훅 REPORT_EMBED_FAILED가 찍히고 visual_pages는
      // 한 번도 기록되지 않았다.
      if (report) {
        await supabaseRest(where, { method: "PATCH", prefer: "return=minimal", body: {
          parse_quality: report.parse_quality, visual_pages: report.visual_pages,
        } }).catch(() => {});
      }
    } catch (error) {
      console.error("[REPORT_EMBED_FAILED]", JSON.stringify({ companyId: row.company_id, url: row.report_url, message: error.message }));
    }
  }
  return { embedded, reports, remaining: Math.max(pending.length - opened, 0) };
}

// 커버리지 계획 가운데 장부에 없는 (회사, 창) 하나를 고른다.
export async function pickDueReport(now = new Date()) {
  const ledger = await supabaseRest("report_digest?select=company_id,kind,report_url,published_at,digested_at");
  for (const window of coverageWindows(now)) {
    for (const company of TRACKED_COMPANIES) {
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
  for (const company of TRACKED_COMPANIES) {
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

// 추출 진단값을 장부에 적는다. digestReport가 이미 돌려주는 값인데 예전에는 어디에도 남지 않아
// "몇 건을 냈고 몇 건을 버렸는지"를 나중에 셀 수 없었다(2026-09-08 완룬 점검).
//
// 별개 PATCH로 두고 실패를 삼키는 이유: supabase/report-digest-diagnostics.sql을 아직 실행하지
// 않은 운영 DB에서는 PostgREST가 없는 컬럼에 400을 낸다. 본 PATCH에 합치면 그때 parse_quality나
// events_inserted 같은 실제 데이터까지 함께 저장에 실패한다. 진단값은 없어도 파이프라인이 돈다.
async function writeDigestDiagnostics(companyId, reportUrl, diagnostics) {
  if (!diagnostics) return;
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(companyId)}&report_url=eq.${encodeURIComponent(reportUrl)}`, {
    method: "PATCH", prefer: "return=minimal", body: diagnostics,
  }).catch((error) => {
    console.warn("[DIGEST_DIAGNOSTICS_SKIPPED]", JSON.stringify({ companyId, message: String(error.message || error).slice(0, 160) }));
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

  const { rows, dropped, returned, report, diagnostics, per_chunk_returned: perChunk } = await digestReport({ company, kind, knownUrl: found.url, maxEvents: DIGEST_MAX_EVENTS, timeoutMs: REPORT_LLM_TIMEOUT_MS });
  const reportName = `${company.name_ko} ${found.title}`;
  for (const row of rows) row.source_name = reportName;
  const { inserted, embedded } = await storeEvents(company, rows);
  // 거래소에 공개된 자료라 원문을 그대로 남긴다. 사실 몇 줄만 남기고 버리면 그 밖의 내용은
  // 다시 볼 수도, 검색할 수도 없다. 임베딩은 별도 훅이 이어받는다(report_chunk).
  await writeLedger({
    company_id: company.id, kind, report_url: found.url, report_title: found.title,
    published_at: found.published_at, events_inserted: inserted, enriched_at: new Date().toISOString(),
    body_original: report?.text || null, body_section: report?.section || null, body_chars: report?.text?.length || null,
  });
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(found.url)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: { parse_quality: report?.parse_quality || "text_only", visual_pages: report?.visual_pages || [] },
  }).catch(() => {});
  await writeDigestDiagnostics(company.id, found.url, diagnostics);
  return { status: "digested", company_id: company.id, kind, fiscal: window?.fiscal, title: found.title, returned, kept: rows.length, inserted, embedded, dropped, per_chunk_returned: perChunk };
}

// 보강 패스. 옛 규칙으로 읽어 사실이 적게 남은 보고서부터 새 규칙으로 다시 읽고, 새로 나온 사실만 더한다.
export async function pickThinReport() {
  const rows = await supabaseRest("report_digest?select=company_id,kind,report_url,report_title,events_inserted&enriched_at=is.null&kind=in.(annual,semiannual)&order=events_inserted.asc,published_at.desc&limit=50");
  return rows.find((row) => !row.report_url.startsWith("missing:") && !row.report_url.startsWith("web:")) || null;
}

export async function enrichReport(row) {
  const company = COMPANIES.find((item) => item.id === row.company_id);
  if (!company) return { status: "unknown_company", company_id: row.company_id };
  const { rows, dropped, returned, report, diagnostics, per_chunk_returned: perChunk } = await digestReport({ company, kind: row.kind, knownUrl: row.report_url, maxEvents: DIGEST_MAX_EVENTS, timeoutMs: REPORT_LLM_TIMEOUT_MS });
  const reportName = `${company.name_ko} ${row.report_title || ""}`.trim();
  for (const item of rows) item.source_name = reportName;
  const { inserted, embedded } = await storeEvents(company, rows);
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(row.report_url)}`, {
    method: "PATCH", prefer: "return=minimal",
    // 어차피 읽은 김에 원문도 채운다. 예전에 읽은 보고서는 본문이 비어 있다.
    body: {
      enriched_at: new Date().toISOString(), events_inserted: (row.events_inserted || 0) + inserted,
      body_original: report?.text || null, body_section: report?.section || null, body_chars: report?.text?.length || null,
    },
  });
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(row.report_url)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: { parse_quality: report?.parse_quality || "text_only", visual_pages: report?.visual_pages || [] },
  }).catch(() => {});
  await writeDigestDiagnostics(company.id, row.report_url, diagnostics);
  return { status: "enriched", company_id: company.id, kind: row.kind, title: row.report_title, before: row.events_inserted, returned, kept: rows.length, inserted, embedded, dropped, per_chunk_returned: perChunk };
}

export async function pickRenewalReport() {
  const ids = TRACKED_COMPANIES.filter((company) => company.cninfo || company.hkex).map((company) => company.id);
  const rows = await supabaseRest(
    `report_digest?select=company_id,kind,report_url,report_title,events_inserted,published_at` +
    `&company_id=in.(${ids.join(",")})&kind=in.(annual,semiannual)&published_at=gte.2024-01-01` +
    `&renewed_at=is.null&order=published_at.desc&limit=100`
  );
  return (rows || []).find((row) => !row.report_url.startsWith("missing:") && !row.report_url.startsWith("web:")) || null;
}

// 갱신은 덧붙이기가 아니라 바꿔 넣기다. 옛 이벤트는 셀이 붙고 단위가 떨어진 텍스트에서 나왔고
// (2026-09-07 Farasis 보증 표 5건이 10배 작게 저장), 덧붙이기만 하면 storeEvents의 sameFact가
// 같은 제목의 옛 오류 건과 새 정답 건을 같은 사실로 보아 정답을 버린다. 그래서 새로 읽은 결과가
// 충분히 나왔을 때만 그 보고서의 옛 이벤트를 지우고 새 것으로 채운다(knowledge_chunk·event_fact·
// concept_edge는 on delete cascade). 새 결과가 얇으면(timeout·짧은 읽기) 옛 것을 지키고 덧붙이기만 한다.
const RENEW_REPLACE_MIN_EVENTS = 3;
const RENEW_REPLACE_MIN_RATIO = 0.5;

export async function renewReport(row) {
  const company = TRACKED_COMPANIES.find((item) => item.id === row.company_id);
  if (!company) return { status: "inactive_company", company_id: row.company_id };
  const { rows, dropped, returned, report, diagnostics, per_chunk_returned: perChunk } = await digestReport({ company, kind: row.kind, knownUrl: row.report_url, maxEvents: DIGEST_MAX_EVENTS, timeoutMs: REPORT_LLM_TIMEOUT_MS });
  const reportName = `${company.name_ko} ${row.report_title || ""}`.trim();
  for (const item of rows) item.source_name = reportName;
  const where = `company_id=eq.${encodeURIComponent(company.id)}&source_url=eq.${encodeURIComponent(row.report_url)}`;
  const oldCount = Number(row.events_inserted || 0);
  // 조각이 하나라도 실패했으면 이 읽기는 부분이다. 건수가 하한을 넘더라도 옛 이벤트를 지우지 않는다.
  // 지운 뒤 부분 결과로 채우면 실패한 조각 구간의 사실이 영구히 사라진다.
  const partial = (diagnostics?.digest_chunks_failed || 0) > 0;
  const canReplace = !partial && rows.length >= Math.max(RENEW_REPLACE_MIN_EVENTS, Math.ceil(oldCount * RENEW_REPLACE_MIN_RATIO));
  let replaced = 0;
  if (canReplace) {
    const old = await supabaseRest(`event?select=id&${where}`);
    if (old.length) {
      await supabaseRest(`event?${where}`, { method: "DELETE" });
      replaced = old.length;
    }
  }
  const { inserted, embedded } = await storeEvents(company, rows);
  const renewalStatus = report.visual_pages?.length ? "visual_review_required" : "renewed_text_only";
  await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(company.id)}&report_url=eq.${encodeURIComponent(row.report_url)}`, {
    method: "PATCH", prefer: "return=minimal", body: {
      renewed_at: new Date().toISOString(), renewal_status: renewalStatus,
      renewal_inserted: inserted, source_sha256: report.source_sha256,
      body_original: report.text, body_section: report.section, body_chars: report.text.length,
      parse_quality: report.parse_quality, visual_pages: report.visual_pages || [],
      events_inserted: replaced ? inserted : (row.events_inserted || 0) + inserted,
    },
  });
  await writeDigestDiagnostics(company.id, row.report_url, diagnostics);
  return { status: renewalStatus, company_id: company.id, kind: row.kind, title: row.report_title, partial, per_chunk_returned: perChunk,
    returned, kept: rows.length, replaced, inserted, embedded, visual_pages: report.visual_pages || [], dropped };
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
  const { rows, dropped, returned } = await backfillCompanyEvents({ company, since, until, maxEvents: 10, timeoutMs: WEB_LLM_TIMEOUT_MS });
  const { inserted, embedded } = await storeEvents(company, rows);
  await writeLedger({ company_id: company.id, kind: "web", report_url: `web:${year}:${today}`, report_title: `웹 백필 ${since}~${until}`, events_inserted: inserted });
  return { status: "web_backfilled", company_id: company.id, year, returned, kept: rows.length, inserted, embedded, dropped };
}

// 한 호출 분량의 유지 작업. 예산이 다하면 남은 일은 다음 호출로 넘긴다.
// 시점 근거(occurred_basis)가 없는 기사 이벤트를 회사 단위로 묶어 웹 검색으로 재확인한다.
// 한 훅에 회사 하나(최대 20건, 검색 요청 1회). 확인 결과는 근거 문장과 함께 남겨 두 번 검색하지 않는다.
export async function redateMissingArticleEvents(limit = 20) {
  const rows = await supabaseRest(
    "event?select=id,company_id,occurred_at,title_ko,fact_ko,article(published_at)"
    + "&evidence_kind=in.(article,web_backfill)&occurred_basis=is.null&order=company_id.asc,occurred_at.desc&limit=200"
  );
  if (!rows?.length) return { checked: 0, changed: 0, remaining: 0 };
  const companyId = rows[0].company_id;
  const company = COMPANIES.find((item) => item.id === companyId);
  const batch = rows.filter((row) => row.company_id === companyId).slice(0, limit)
    .map((row) => ({ ...row, article_published_at: row.article?.published_at ? String(row.article.published_at).slice(0, 10) : null }));
  if (!company || !batch.length) return { checked: 0, changed: 0, remaining: rows.length };
  const { items, checked } = await redateArticleEvents({ company, events: batch });
  let changed = 0;
  for (const item of items) {
    await supabaseRest(`event?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH", prefer: "return=minimal",
      body: { occurred_at: item.occurred_at, occurred_precision: item.occurred_precision, occurred_basis: item.occurred_basis },
    });
    if (item.changed) changed += 1;
  }
  // 시점이 바뀐 이벤트는 벡터 청크의 [시점] 줄도 달라진다. 다시 임베딩한다.
  const changedIds = items.filter((item) => item.changed).map((item) => item.id);
  if (changedIds.length) {
    try {
      const updated = await supabaseRest(`event?select=*&id=in.(${changedIds.join(",")})`);
      await embedEvents((updated || []).map((row) => ({ ...row, company_name_ko: company.name_ko })));
    } catch (error) {
      console.error("[ARTICLE_REDATE_EMBED_FAILED]", JSON.stringify({ companyId, message: error.message }));
    }
  }
  return { company_id: companyId, checked, changed, remaining: Math.max(rows.length - batch.length, 0) };
}

// 남은 일이 있는지 값싸게 확인한다. 각 큐에서 한 행만 집어 존재 여부만 본다.
// 훅이 무거운 단계를 하나씩 번갈아 맡기 때문에, 이번 훅이 건드리지 않은 큐에 일이 남아 있는지
// 알아야 체인을 이어 갈지 정할 수 있다. LLM을 부르지 않으므로 비용이 없다.
async function runDueReport() {
  let due = null;
  try {
    due = await pickDueReport();
    return due ? await digestCompany(due.company, due.kind, due.window) : { status: "idle" };
  } catch (error) {
    if (due) await writeLedger({ company_id: due.company.id, kind: due.kind, report_url: `${windowTag(due.window)}:${error.message.slice(0, 40)}` }).catch(() => {});
    return { error: error.message, company_id: due?.company?.id, kind: due?.kind, fiscal: due?.window?.fiscal };
  }
}

async function runDueWebBackfill() {
  let due = null;
  try {
    due = await pickDueWebBackfill();
    return due ? await webBackfillCompany(due.company, due.year) : { status: "idle" };
  } catch (error) {
    if (due) await writeLedger({ company_id: due.company.id, kind: "web", report_url: `web:${due.year}:failed:${new Date().toISOString().slice(0, 10)}` }).catch(() => {});
    return { error: error.message, company_id: due?.company?.id, year: due?.year };
  }
}

async function runThinReportEnrichment() {
  let thin = null;
  try {
    thin = await pickThinReport();
    return thin ? await enrichReport(thin) : { status: "idle" };
  } catch (error) {
    if (thin && !isTimeoutError(error)) await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(thin.company_id)}&report_url=eq.${encodeURIComponent(thin.report_url)}`, {
      method: "PATCH", prefer: "return=minimal", body: { enriched_at: new Date().toISOString() },
    }).catch(() => {});
    return { error: error.message, retry: isTimeoutError(error), company_id: thin?.company_id, title: thin?.report_title };
  }
}

export async function runReportRenewal() {
  const row = await pickRenewalReport();
  if (!row) return { status: "idle" };
  try { return await renewReport(row); }
  catch (error) {
    if (!isTimeoutError(error)) await supabaseRest(`report_digest?company_id=eq.${encodeURIComponent(row.company_id)}&report_url=eq.${encodeURIComponent(row.report_url)}`, {
      method: "PATCH", prefer: "return=minimal", body: { renewed_at: new Date().toISOString(), renewal_status: "failed" },
    }).catch(() => {});
    return { status: "failed", error: error.message, retry: isTimeoutError(error), company_id: row.company_id, title: row.report_title };
  }
}

async function pendingWork() {
  const has = async (path) => {
    try { return ((await supabaseRest(path)) || []).length > 0; } catch { return false; }
  };
  const [facts, concepts, basis, article, headline, report, digest, web, enrich, renew] = await Promise.all([
    has("event?select=id&facts_extracted_at=is.null&timeline_eligibility=neq.exclude&limit=1"),
    has("event?select=id&concepts_extracted_at=is.null&timeline_eligibility=neq.exclude&limit=1"),
    has("event?select=id&evidence_kind=in.(article,web_backfill)&occurred_basis=is.null&limit=1"),
    has(`article?select=id&verification_status=eq.verified&embedding_status=neq.embedded&body_original=not.is.null&embedding_attempts=lt.${ARTICLE_EMBED_MAX_ATTEMPTS}&limit=1`),
    has("article?select=id&verification_status=eq.pending&headline_embedded_at=is.null&title_original=not.is.null&limit=1"),
    REPORT_TEXT_ONLY_EMBEDDING
      ? has("report_digest?select=report_url&kind=in.(annual,semiannual)&or=(embedded_total.is.null,embedded_chunks.lt.embedded_total)&limit=1")
      : Promise.resolve(false),
    pickDueReport().then(Boolean).catch(() => false),
    pickDueWebBackfill().then(Boolean).catch(() => false),
    pickThinReport().then(Boolean).catch(() => false),
    pickRenewalReport().then(Boolean).catch(() => false),
  ]);
  return { facts, concepts, basis, article, headline, report, digest, web, enrich, renew };
}

// 무거운 단계는 보고서 읽기·웹 백필·보강을 포함해 한 훅에 하나만 맡는다.
//
// 예전에는 한 훅이 모든 단계를 차례로 시도했다. LLM 호출 하나가 25~40초라 두세 단계만 돌아도
// 60초 함수 한도를 넘어 함수가 죽고, 다음 훅 호출이 나가지 못해 체인이 끊겼다(2026-09-08:
// 훅이 82초·97초를 쓰고 2~4훅에서 멈춤). 훅마다 하나씩 돌아가며 맡으면 한 훅이 한 작업이라
// 한도 안에 들어오고, 대신 훅을 많이(최대 40회) 이어 붙여 총량을 낸다.
const HEAVY_TASKS = [
  ["facts", ({ deadline }) => extractMissingFacts({ deadline })],
  ["embed_report", ({ deadline }) => embedMissingReports({ deadline })],
  ["embed_article", () => embedMissingArticles()],
  ["embed_headline", ({ deadline }) => embedPendingHeadlines({ deadline })],
  ["redate_article", () => redateMissingArticleEvents()],
  ["concepts", ({ deadline }) => extractMissingConcepts({ deadline })],
  ["digest", () => runDueReport()],
  ["web", () => runDueWebBackfill()],
  ["enrich", () => runThinReportEnrichment()],
  ["renew", () => runReportRenewal()],
];

export async function runCurationHop({ deadline, hop = 1 }) {
  const log = { hop_task: null };
  // 값싼 단계는 매 훅 돈다. 임베딩 API만 부르고 LLM은 부르지 않는다.
  try { log.embed = await embedMissingEvents(); } catch (error) { log.embed = { error: error.message }; }
  if (Date.now() > deadline) return { log, more: true };

  // 이번 훅이 맡을 무거운 단계 하나.
  const [taskName, runTask] = HEAVY_TASKS[(Math.max(1, hop) - 1) % HEAVY_TASKS.length];
  log.hop_task = taskName;
  try { log[taskName] = await runTask({ deadline }); } catch (error) { log[taskName] = { error: error.message }; }

  // 남은 일이 있는지는 큐를 직접 확인한다. 이번 훅이 건드리지 않은 단계도 봐야 한다.
  const pending = await pendingWork();
  log.pending = pending;
  const more = Object.values(pending).some(Boolean)
    || Boolean(log.embed && log.embed.remaining > 0);
  return { log, more };
}
