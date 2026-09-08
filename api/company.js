import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { requireAccess } from "../lib/access.js";
import { COMPANIES, TRACKED_COMPANIES, SELECTION_BASIS } from "../lib/china-sources.js";
import { groupSummary } from "../lib/company-groups.js";
import { answerFromKnowledge } from "../lib/knowledge-search.js";
import { buildCompareReport, applyVerifiedFacts, buildReportSynthesis } from "../lib/compare-report.js";
import { buildTimelineReport } from "../lib/timeline-report.js";

// 비교 리포트는 LLM 두 번(작성 + 웹 검증), 함의 종합은 긴 입력 한 번을 부른다. `api/*.js` Node 함수는
// `export const config = { maxDuration }` 형식만 읽으므로(예전 `export const maxDuration`은 무시됐다)
// Fluid Hobby 한도인 300초를 이 형식으로 명시한다.
export const config = { maxDuration: 300 };

// 함의 종합에 한 번에 넣을 비교 리포트 수. 여섯 건이면 입력 3만 자 안팎이라 한 호출로 끝난다.
const MAX_SYNTHESIS_REPORTS = 6;
const HISTORY_PAGE_SIZE = 30;
const HISTORY_SELECT_BASE = "id,created_at,company_a_id,company_b_id,company_a_name_ko,company_b_name_ko,include_supporting,headline_ko:report->>headline_ko";
// kind·title_ko·source_history_ids는 supabase/report-synthesis.sql이 만든다. SQL 적용 전에는 예전 컬럼만 읽는다.
const HISTORY_SELECT_FULL = `${HISTORY_SELECT_BASE},kind,title_ko,source_history_ids`;

const VALUE_CHAINS = ["cell", "cathode", "anode"];

// 화면의 회사 목록은 DB가 비어 있어도 마스터에서 그대로 나와야 하므로 정적 마스터를 기준으로 만든다.
function catalogEntry(company) {
  return {
    id: company.id,
    name_ko: company.name_ko,
    name_zh: company.name_zh,
    name_en: company.name_en,
    type_tags: company.type_tags,
    value_chain: VALUE_CHAINS.find((tag) => company.type_tags.includes(tag)) || "other",
    priority: company.priority ?? null,
    // 공식 홈페이지. 화면이 이 도메인의 파비콘을 회사 마크로 쓴다. 확인된 회사만 채워져 있다.
    homepage: company.homepage || null,
    // 화면 목록에 종목코드를 함께 보여 준다. 비상장사는 코드가 없어 null이다.
    ticker: company.cninfo?.codes?.[0]
      ? `${company.cninfo.codes[0]}.${company.cninfo.column === "sse" ? "SH" : "SZ"}`
      : company.hkex?.code ? `${company.hkex.code}.HK` : null,
    note_ko: company.note_ko || null,
    group: groupSummary(company.id),
  };
}

// 밸류체인 순서 → SNE 순위(없으면 뒤) → 한국어명 순으로 내보낸다.
function sortedCatalog() {
  return TRACKED_COMPANIES.map(catalogEntry).sort((a, b) => {
    const chain = VALUE_CHAINS.indexOf(a.value_chain) - VALUE_CHAINS.indexOf(b.value_chain);
    if (chain) return chain;
    const rank = (a.priority ?? 99) - (b.priority ?? 99);
    return rank || a.name_ko.localeCompare(b.name_ko, "ko");
  });
}

const EVENT_SELECT = "id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,region_scope,source_url,source_name,original_excerpt,original_excerpt_ko,timeline_eligibility,entity_names,evidence_kind,article(canonical_url,source_name,source_tier)";

// 정량 궤적용 지표. line_item_zh와 원문 표기를 함께 보내 화면이 계정을 밝히고 검산할 수 있게 한다.
const METRIC_SELECT = "period,metric,value,unit,currency,line_item_zh,quantity_text,yoy_pct_stated,excerpt,report_kind,source_url,occurred_at";

// 근거 인용 질의응답. 새 함수 파일을 만들지 않으려고 기업 API에 붙였다.
async function runAsk(request, response) {
  const question = String(request.body?.question || request.query?.question || "").trim();
  if (question.length < 2) return response.status(400).json({ status: "invalid_request", message: "질문을 입력해 주세요." });
  if (question.length > 500) return response.status(400).json({ status: "invalid_request", message: "질문이 너무 깁니다." });
  const companyId = String(request.body?.companyId || request.query?.companyId || "").trim();
  if (companyId && !COMPANIES.some((item) => item.id === companyId)) return response.status(404).json({ status: "unknown_company" });
  // 본문 대조를 거치지 않은 헤드라인까지 근거로 볼지. 화면 토글이 정하고 기본은 제외다.
  const includeUnverified = request.body?.includeUnverified === true || String(request.query?.include_unverified || "") === "1";
  try {
    const result = await answerFromKnowledge({ question, companyId: companyId || null, includeUnverified });
    // 하이브리드가 실제로 두 갈래로 돌았는지는 로그에서 바로 보여야 한다.
    // lexical_matched가 계속 0이면 supabase/hybrid-search.sql이 아직 적용되지 않았거나 질의가 비어 있는 것이다.
    console.info("[KNOWLEDGE_ASK]", JSON.stringify({ companyId: companyId || "all", matched: result.matched, unverified: result.unverified_matched || 0, include_unverified: includeUnverified, sufficient: result.sufficient, retrieval: result.retrieval || null }));
    return response.status(200).json({ status: "ok", question, company_id: companyId || null, include_unverified: includeUnverified, ...result });
  } catch (error) {
    console.error("[KNOWLEDGE_ASK_FAILED]", JSON.stringify({ message: error.message }));
    return response.status(502).json({ status: "ask_failed", message: error.message });
  }
}

// 비교 화면에 실제로 표시된 이벤트를 그대로 근거로 삼는다. 서버가 다시 조회하면
// 화면에 보이는 것과 리포트 내용이 어긋날 수 있다. 대신 길이와 건수는 서버에서 자른다.
function cleanEvents(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, 60)
    .map((event) => ({
      // 검증자가 "이 이벤트의 날짜가 틀렸다"고 짚을 수 있도록 id를 같이 넘긴다. 형식이 uuid가 아니면 버린다.
      id: /^[0-9a-f-]{36}$/i.test(String(event?.id || "")) ? String(event.id) : "",
      date: String(event?.date || "").slice(0, 10),
      track: event?.track === "tech" || event?.track === "technology" ? "tech" : "market",
      title: String(event?.title || "").slice(0, 160),
      fact: String(event?.fact || "").slice(0, 400),
      sourceName: String(event?.sourceName || "").slice(0, 80)
    }))
    .filter((event) => event.title);
}

// 기업 화면에 실제로 표시된 시간축 이벤트만 리포트의 재료로 쓴다. 화면의 "보조 데이터 포함"
// 선택과 서버 리포트의 근거가 어긋나지 않게 하며, 클라이언트 입력은 길이·형식만 보수적으로 제한한다.
function cleanTimelineEvents(list) {
  return (Array.isArray(list) ? list : []).slice(0, 80).map(event => ({
    id: /^[0-9a-f-]{36}$/i.test(String(event?.id || "")) ? String(event.id) : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(event?.date || "")) ? String(event.date) : "",
    track: event?.track === "tech" || event?.track === "technology" ? "tech" : "market",
    layer: String(event?.layer || "").slice(0, 80),
    period: String(event?.period || "").slice(0, 30),
    title: String(event?.title || "").slice(0, 180),
    fact: String(event?.fact || "").slice(0, 500),
    sourceName: String(event?.sourceName || "").slice(0, 100),
    sourceUrl: /^https?:\/\//i.test(String(event?.sourceUrl || "")) ? String(event.sourceUrl).slice(0, 500) : "",
  })).filter(event => event.id && event.date && event.title && event.fact);
}

// 비교 관계는 현재 마스터의 밸류체인 태그로만 잠정 분류한다. 고객·실거래·화학계는 추정하지 않는다.
function pairContext(a, b, eventsA, eventsB) {
  const chainOf = company => ["cell", "cathode", "anode"].find(tag => company.type_tags.includes(tag)) || "other";
  const chainA = chainOf(a), chainB = chainOf(b);
  const mode = chainA === chainB ? "P" : (chainA === "cell" || chainB === "cell") ? "V" : (new Set([chainA, chainB]).size === 2 ? "C" : "X");
  const label = { P: "동종 밸류체인(잠정)", V: "셀-소재 수직 연쇄 가능성", C: "인접 소재", X: "비교 축 미확보" }[mode];
  const coverage = events => {
    const dates = events.map(event => event.date).filter(Boolean).sort();
    return { total: events.length, market: events.filter(event => event.track === "market").length, tech: events.filter(event => event.track === "tech").length, earliest: dates[0] || "미상", latest: dates.at(-1) || "미상" };
  };
  return { mode, label_ko: label, note_ko: "밸류체인 태그만으로 한 잠정 분류이며 고객·거래·화학계 중복은 입력에 없으면 미확보로 둡니다.", coverage_a: coverage(eventsA), coverage_b: coverage(eventsB) };
}

async function runTimelineReport(request, response) {
  const companyId = String(request.body?.companyId || "").trim();
  const company = COMPANIES.find(item => item.id === companyId);
  if (!company) return response.status(404).json({ status: "unknown_company" });
  const events = cleanTimelineEvents(request.body?.events);
  if (!events.length) return response.status(400).json({ status: "no_evidence", message: "현재 화면에 리포트 근거로 쓸 시계열 이벤트가 없습니다." });
  try {
    const result = await buildTimelineReport({ companyName: company.name_ko, events });
    console.info("[TIMELINE_REPORT]", JSON.stringify({ companyId, events: events.length, reportChars: result.report.markdown_ko.length }));
    return response.status(200).json({ status: "ok", company_id: companyId, company_name_ko: company.name_ko, events, generated_at: new Date().toISOString(), ...result });
  } catch (error) {
    console.error("[TIMELINE_REPORT_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: "timeline_report_failed", message: error.message });
  }
}

async function runCompareReport(request, response) {
  const idA = String(request.body?.companyA || "").trim();
  const idB = String(request.body?.companyB || "").trim();
  const a = COMPANIES.find((item) => item.id === idA);
  const b = COMPANIES.find((item) => item.id === idB);
  if (!a || !b) return response.status(404).json({ status: "unknown_company" });
  if (idA === idB) return response.status(400).json({ status: "invalid_request", message: "서로 다른 두 회사를 골라 주세요." });
  const eventsA = cleanEvents(request.body?.eventsA);
  const eventsB = cleanEvents(request.body?.eventsB);
  const pairContextValue = pairContext(a, b, eventsA, eventsB);
  const includeSupporting = request.body?.includeSupporting === true;
  if (!eventsA.length && !eventsB.length) return response.status(400).json({ status: "no_evidence", message: "비교 화면에 근거로 쓸 이벤트가 없습니다." });
  try {
    const result = await buildCompareReport({ companyIdA: a.id, companyIdB: b.id, nameA: a.name_ko, nameB: b.name_ko, eventsA, eventsB, pairContext: pairContextValue });
    // 웹 검증이 확인한 것은 리포트에만 두지 않고 DB에 되돌린다. 실패해도 리포트는 그대로 낸다.
    let dbUpdates = null;
    try {
      dbUpdates = await applyVerifiedFacts({ companyA: a, companyB: b, report: result.report, knownEventIds: [...eventsA, ...eventsB].map((event) => event.id).filter(Boolean) });
    } catch (error) {
      console.error("[COMPARE_REPORT_APPLY_FAILED]", JSON.stringify({ idA, idB, message: error.message }));
      dbUpdates = { dates_fixed: 0, events_added: 0, embedded: 0, skipped: [error.message] };
    }
    console.info("[COMPARE_REPORT]", JSON.stringify({ idA, idB, events: eventsA.length + eventsB.length, status: result.verification_status, db: dbUpdates }));
    const generatedAt = new Date().toISOString();
    // 히스토리 저장. 실패해도(예: 일시적 DB 오류) 방금 만든 리포트는 그대로 응답한다.
    // 다만 저장 실패를 화면에 알려야 한다. 안 그러면 리포트는 보이는데 히스토리에는 없는 상태를
    // 사용자가 알 방법이 없다. 이유를 함께 내려보낸다.
    let historyId = null;
    let historyError = null;
    try {
      const [saved] = await supabaseRest("compare_report_history", {
        method: "POST", prefer: "return=representation",
        body: {
          company_a_id: idA, company_b_id: idB,
          company_a_name_ko: a.name_ko, company_b_name_ko: b.name_ko,
          events_a_count: eventsA.length, events_b_count: eventsB.length,
          include_supporting: includeSupporting,
          report: result.report, model: result.model || null,
          verification_status: result.verification_status, searched_sources: result.searched_sources || []
        }
      });
      historyId = saved?.id || null;
      if (!historyId) historyError = "저장 요청은 성공했으나 저장된 행을 돌려받지 못했습니다.";
    } catch (error) {
      console.error("[COMPARE_REPORT_HISTORY_SAVE_FAILED]", JSON.stringify({ idA, idB, message: error.message }));
      historyError = error.message || "알 수 없는 오류";
    }
    return response.status(200).json({
      status: "ok", company_a: a.name_ko, company_b: b.name_ko,
      events_a: eventsA.length, events_b: eventsB.length, include_supporting: includeSupporting,
      generated_at: generatedAt, history_id: historyId, history_error: historyError,
      db_updates: dbUpdates, pair_context: pairContextValue, ...result
    });
  } catch (error) {
    console.error("[COMPARE_REPORT_FAILED]", JSON.stringify({ idA, idB, message: error.message }));
    return response.status(502).json({ status: "report_failed", message: error.message });
  }
}

function historyLabel(row) {
  return `${row.company_a_name_ko} vs ${row.company_b_name_ko}`;
}

// 지난 비교 리포트 여러 건을 골라 함의를 종합한다. 재료는 compare 행만이다. 종합을 다시 종합에 넣으면
// 해석 위에 해석을 쌓는 셈이라(근거에서 여러 단계 건너뛴 결론) 제품 불변조건에 어긋난다.
async function runReportSynthesis(request, response) {
  const ids = [...new Set((Array.isArray(request.body?.historyIds) ? request.body.historyIds : []).map((id) => String(id || "").trim()).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (ids.length < 2) return response.status(400).json({ status: "invalid_request", message: "비교 리포트를 2건 이상 골라 주세요." });
  if (ids.length > MAX_SYNTHESIS_REPORTS) return response.status(400).json({ status: "invalid_request", message: `한 번에 ${MAX_SYNTHESIS_REPORTS}건까지 종합할 수 있습니다.` });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
  let rows;
  try {
    rows = await supabaseRest(`compare_report_history?select=id,created_at,company_a_id,company_b_id,company_a_name_ko,company_b_name_ko,include_supporting,verification_status,report,kind&id=in.(${ids.join(",")})`);
  } catch (error) {
    if (/kind/.test(error.message || "")) return response.status(503).json({ status: "schema_missing", message: "supabase/report-synthesis.sql을 운영 DB에 먼저 적용해야 합니다." });
    console.error("[REPORT_SYNTHESIS_LOAD_FAILED]", JSON.stringify({ ids, message: error.message }));
    return response.status(502).json({ status: error.code || "db_error", message: error.message });
  }
  // 선택한 순서를 지켜 [R1], [R2]… 번호가 화면과 같게 한다.
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const reports = ids.map((id) => byId.get(id)).filter((row) => row && (row.kind || "compare") === "compare");
  if (reports.length < 2) return response.status(400).json({ status: "invalid_request", message: "비교 리포트만 종합할 수 있습니다. 함의 리포트는 재료에서 빠집니다." });
  try {
    const { synthesis, model } = await buildReportSynthesis({ reports });
    const generatedAt = new Date().toISOString();
    let historyId = null;
    let historyError = null;
    try {
      const [saved] = await supabaseRest("compare_report_history", {
        method: "POST", prefer: "return=representation",
        body: {
          kind: "synthesis", source_history_ids: reports.map((row) => row.id), title_ko: synthesis.title_ko || null,
          include_supporting: reports.some((row) => row.include_supporting),
          events_a_count: 0, events_b_count: 0,
          report: synthesis, model: model || null, verification_status: "synthesis_no_web", searched_sources: [],
        },
      });
      historyId = saved?.id || null;
      if (!historyId) historyError = "저장 요청은 성공했으나 저장된 행을 돌려받지 못했습니다.";
    } catch (error) {
      console.error("[REPORT_SYNTHESIS_HISTORY_SAVE_FAILED]", JSON.stringify({ message: error.message }));
      historyError = error.message || "알 수 없는 오류";
    }
    console.info("[REPORT_SYNTHESIS]", JSON.stringify({ reports: reports.length, threads: synthesis.threads.length, implications: synthesis.korea_implications.length, saved: Boolean(historyId) }));
    return response.status(200).json({
      status: "ok", kind: "synthesis", synthesis, model: model || null, generated_at: generatedAt,
      sources: reports.map((row) => ({ id: row.id, label: historyLabel(row), created_at: row.created_at, include_supporting: row.include_supporting })),
      history_id: historyId, history_error: historyError,
    });
  } catch (error) {
    console.error("[REPORT_SYNTHESIS_FAILED]", JSON.stringify({ ids, message: error.message }));
    return response.status(502).json({ status: "synthesis_failed", message: error.message });
  }
}

async function handleRequest(request, response) {
  if (!requireAccess(request, response)) return;
  if (request.method === "POST") {
    if (String(request.body?.mode || "") === "compare_report") return runCompareReport(request, response);
    if (String(request.body?.mode || "") === "synthesize_reports") return runReportSynthesis(request, response);
    if (String(request.body?.mode || "") === "timeline_report") return runTimelineReport(request, response);
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
    return runAsk(request, response);
  }
  // 비교 리포트 히스토리 목록. report 본문은 크므로 목록에는 안 담고 헤드라인만 뽑아 낸다.
  // offset으로 페이지를 넘긴다("더보기"). 한 페이지 더 있는지는 한 건을 더 읽어 판단한다.
  if (String(request.query.compare_history || "") === "1") {
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured", history: [] });
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || HISTORY_PAGE_SIZE));
    const page = (select) => supabaseRest(`compare_report_history?select=${select}&order=created_at.desc&limit=${limit + 1}&offset=${offset}`);
    try {
      let rows;
      try { rows = await page(HISTORY_SELECT_FULL); }
      catch (error) {
        // 종합 컬럼이 아직 없는 DB. 목록은 예전 모양으로라도 나와야 한다.
        if (!/kind|title_ko|source_history_ids/.test(error.message || "")) throw error;
        rows = (await page(HISTORY_SELECT_BASE)).map((row) => ({ ...row, kind: "compare", title_ko: null, source_history_ids: null }));
      }
      const hasMore = rows.length > limit;
      return response.status(200).json({ status: "ok", history: rows.slice(0, limit), offset, has_more: hasMore, next_offset: offset + limit });
    } catch (error) {
      console.error("[COMPARE_HISTORY_QUERY_FAILED]", JSON.stringify({ message: error.message }));
      return response.status(502).json({ status: error.code || "db_error", history: [] });
    }
  }
  const compareHistoryId = String(request.query.compare_history_id || "").trim();
  if (compareHistoryId) {
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
    try {
      const rows = await supabaseRest(`compare_report_history?select=*&id=eq.${encodeURIComponent(compareHistoryId)}&limit=1`);
      if (!rows.length) return response.status(404).json({ status: "not_found" });
      const row = rows[0];
      if (row.kind === "synthesis") {
        // 재료 리포트의 이름표를 함께 내려 화면이 [R1]·[R2]를 회사명으로 풀어 보이게 한다.
        const sourceIds = Array.isArray(row.source_history_ids) ? row.source_history_ids : [];
        const sourceRows = sourceIds.length
          ? await supabaseRest(`compare_report_history?select=id,created_at,company_a_name_ko,company_b_name_ko,include_supporting&id=in.(${sourceIds.join(",")})`).catch(() => [])
          : [];
        const bySource = new Map((sourceRows || []).map((item) => [item.id, item]));
        return response.status(200).json({
          status: "ok", kind: "synthesis", synthesis: row.report, model: row.model, generated_at: row.created_at, history_id: row.id,
          sources: sourceIds.map((id) => bySource.get(id)).filter(Boolean).map((item) => ({ id: item.id, label: historyLabel(item), created_at: item.created_at, include_supporting: item.include_supporting })),
        });
      }
      return response.status(200).json({
        status: "ok", kind: "compare", company_a: row.company_a_name_ko, company_b: row.company_b_name_ko,
        events_a: row.events_a_count, events_b: row.events_b_count, include_supporting: row.include_supporting,
        generated_at: row.created_at, history_id: row.id, report: row.report,
        model: row.model, verification_status: row.verification_status, searched_sources: row.searched_sources || []
      });
    } catch (error) {
      console.error("[COMPARE_HISTORY_DETAIL_FAILED]", JSON.stringify({ id: compareHistoryId, message: error.message }));
      return response.status(502).json({ status: error.code || "db_error" });
    }
  }
  const companyId = String(request.query.companyId || "").trim();
  if (!companyId) return response.status(200).json({ status: "ok", selection_basis: SELECTION_BASIS, companies: sortedCatalog() });

  const master = COMPANIES.find((item) => item.id === companyId);
  if (!master) return response.status(404).json({ status: "unknown_company", message: "추적 대상 회사 마스터에 없는 ID입니다." });
  const company = catalogEntry(master);
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured", company, events: [] });

  try {
    // 정량 궤적은 정기보고서에서만 온다. 지표가 없는 회사(비상장)는 빈 배열이 오고 화면이 기존 카드만 그린다.
    const [events, metrics] = await Promise.all([
      supabaseRest(`event?select=${EVENT_SELECT}&company_id=eq.${encodeURIComponent(companyId)}&timeline_eligibility=neq.exclude&order=occurred_at.asc`),
      supabaseRest(`report_metric?select=${METRIC_SELECT}&company_id=eq.${encodeURIComponent(companyId)}&order=period.asc`).catch((error) => {
        console.error("[COMPANY_METRICS_FAILED]", JSON.stringify({ companyId, message: error.message }));
        return [];
      }),
    ]);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    return response.status(200).json({ status: "ok", company, events, metrics });
  } catch (error) {
    console.error("[COMPANY_QUERY_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: error.code || "db_error", company, events: [] });
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
