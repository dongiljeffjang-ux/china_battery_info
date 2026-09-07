import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { requireAccess } from "../lib/access.js";
import { COMPANIES, TRACKED_COMPANIES, SELECTION_BASIS } from "../lib/china-sources.js";
import { groupSummary } from "../lib/company-groups.js";
import { answerFromKnowledge } from "../lib/knowledge-search.js";
import { buildCompareReport, applyVerifiedFacts } from "../lib/compare-report.js";

// 비교 리포트는 LLM 두 번(작성 + 웹 검증)을 부르므로 기본 10초로는 끝나지 않는다.
export const maxDuration = 60;

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
    console.info("[KNOWLEDGE_ASK]", JSON.stringify({ companyId: companyId || "all", matched: result.matched, unverified: result.unverified_matched || 0, include_unverified: includeUnverified, sufficient: result.sufficient }));
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

async function runCompareReport(request, response) {
  const idA = String(request.body?.companyA || "").trim();
  const idB = String(request.body?.companyB || "").trim();
  const a = COMPANIES.find((item) => item.id === idA);
  const b = COMPANIES.find((item) => item.id === idB);
  if (!a || !b) return response.status(404).json({ status: "unknown_company" });
  if (idA === idB) return response.status(400).json({ status: "invalid_request", message: "서로 다른 두 회사를 골라 주세요." });
  const eventsA = cleanEvents(request.body?.eventsA);
  const eventsB = cleanEvents(request.body?.eventsB);
  const includeSupporting = request.body?.includeSupporting === true;
  if (!eventsA.length && !eventsB.length) return response.status(400).json({ status: "no_evidence", message: "비교 화면에 근거로 쓸 이벤트가 없습니다." });
  try {
    const result = await buildCompareReport({ companyIdA: a.id, companyIdB: b.id, nameA: a.name_ko, nameB: b.name_ko, eventsA, eventsB });
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
      db_updates: dbUpdates, ...result
    });
  } catch (error) {
    console.error("[COMPARE_REPORT_FAILED]", JSON.stringify({ idA, idB, message: error.message }));
    return response.status(502).json({ status: "report_failed", message: error.message });
  }
}

async function handleRequest(request, response) {
  if (!requireAccess(request, response)) return;
  if (request.method === "POST") {
    if (String(request.body?.mode || "") === "compare_report") return runCompareReport(request, response);
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
    return runAsk(request, response);
  }
  // 비교 리포트 히스토리 목록. report 본문은 크므로 목록에는 안 담고 헤드라인만 뽑아 낸다.
  if (String(request.query.compare_history || "") === "1") {
    if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured", history: [] });
    try {
      const rows = await supabaseRest("compare_report_history?select=id,created_at,company_a_id,company_b_id,company_a_name_ko,company_b_name_ko,include_supporting,headline_ko:report->>headline_ko&order=created_at.desc&limit=30");
      return response.status(200).json({ status: "ok", history: rows });
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
      return response.status(200).json({
        status: "ok", company_a: row.company_a_name_ko, company_b: row.company_b_name_ko,
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
    const events = await supabaseRest(`event?select=${EVENT_SELECT}&company_id=eq.${encodeURIComponent(companyId)}&timeline_eligibility=neq.exclude&order=occurred_at.asc`);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    return response.status(200).json({ status: "ok", company, events });
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
