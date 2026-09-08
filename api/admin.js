// 관리자 페이지(품질 점검) 조회 API.
//
// 화면에 보이지 않는 중간 산출물을 그대로 보여 준다: 어느 검색 경로가 무엇을 찾았는지,
// 본문 처리가 왜 실패했는지, 기사 하나가 몇 개 청크로 어떻게 잘렸는지, 임베딩이 붙었는지,
// 벡터 검색이 어떤 질문에 무엇을 돌려주는지. 입장 세션으로만 연다.
//
// 조회(GET)는 읽기 전용이다. 유일한 쓰기는 POST의 벡터 지식 사람 평가(eval-save/eval-delete)이며,
// rag_evaluation 테이블에만 쓴다. 파이프라인 데이터(article/event/knowledge_chunk)는 건드리지 않는다.
import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { requireAccess } from "../lib/access.js";
import { searchKnowledge } from "../lib/knowledge-search.js";
import { chunkArticleBody } from "../lib/vector-ingestion.js";
import { pipelineManifest } from "../lib/pipeline-manifest.js";
import { buildDataAudit } from "../lib/data-audit.js";
import { COMPANIES } from "../lib/china-sources.js";
import { digestReport } from "../lib/event-backfill.js";
import {
  ISSUE_TAGS, VERDICTS, buildEvaluationRow, buildRetrievalSessions, questionKey, summarizeEvaluations,
} from "../lib/rag-evaluation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ARTICLE_LIST_LIMIT = 200;
const AUDIT_PAGE_SIZE = 500;
const AUDIT_MAX_ROWS = 10000;
// 평가 화면이 한 번에 훑는 청크 수와 한 번에 돌려주는 수.
// '미평가만'을 걸면 앞쪽이 전부 평가돼 있을 수 있으므로, 한 페이지를 채울 때까지 뒤로 더 훑는다.
const EVAL_PAGE_SIZE = 40;
const EVAL_SCAN_PAGE = 200;
const EVAL_SCAN_MAX = 1200;
const EVAL_ROWS_MAX = 20000;
const PROBE_REPORTS = {
  "wanrun-2026h1": {
    company_id: "wanrun-new-energy",
    kind: "semiannual",
    url: "https://static.cninfo.com.cn/finalpage/2026-08-29/1225524978.PDF",
  },
};

export const config = { maxDuration: 300 };

function day(value, fallback) { return DAY.test(value || "") ? value : fallback; }
function nextDay(value) { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function enc(value) { return encodeURIComponent(String(value)); }
function safeId(value) { return UUID.test(String(value || "")) ? String(value) : null; }
function safeToken(value) { return /^[a-z0-9_+\-]{1,40}$/i.test(String(value || "")) ? String(value) : null; }

async function overview() {
  const data = await supabaseRest("rpc/admin_overview", { method: "POST", body: {} });
  const lastRuns = await supabaseRest("pipeline_log?select=id,stage,hop,status,duration_ms,created_at&order=created_at.desc&limit=12");
  return { overview: data, last_runs: lastRuns || [] };
}

async function runs(query) {
  const stage = safeToken(query.stage);
  const limit = Math.min(300, Math.max(1, Number(query.limit) || 80));
  const path = `pipeline_log?select=id,stage,hop,status,payload,duration_ms,created_at${stage ? `&stage=eq.${enc(stage)}` : ""}&order=created_at.desc&limit=${limit}`;
  return { runs: await supabaseRest(path) };
}

// 수집 기사 목록. 발견 경로·상태·기간·검색어로 거른다. 청크 수를 함께 실어 임베딩 여부를 한눈에 본다.
async function articles(query) {
  const filters = [];
  const via = safeToken(query.via);
  if (via) filters.push(via === "web_search_deepseek" ? `discovered_via=like.*deepseek*` : via === "web_search_openai" ? `discovered_via=like.*openai*` : `discovered_via=eq.${enc(via)}`);
  const verification = safeToken(query.verification);
  if (verification) filters.push(`verification_status=eq.${enc(verification)}`);
  const processing = safeToken(query.processing);
  if (processing) filters.push(processing === "none" ? "processing_status=is.null" : `processing_status=eq.${enc(processing)}`);
  const embedding = safeToken(query.embedding);
  if (embedding) filters.push(`embedding_status=eq.${enc(embedding)}`);
  const company = safeToken(query.company);
  if (company) filters.push(`article_company.company_id=eq.${enc(company)}`);
  const from = day(query.from, null);
  const to = day(query.to, null);
  const dateField = query.dateField === "published" ? "published_at" : "created_at";
  if (from) filters.push(`${dateField}=gte.${from}`);
  if (to) filters.push(`${dateField}=lt.${nextDay(to)}`);
  const q = String(query.q || "").trim().slice(0, 80);
  if (q) filters.push(`or=(title_original.ilike.*${enc(q)}*,title_ko.ilike.*${enc(q)}*,source_name.ilike.*${enc(q)}*)`);
  const select = "id,title_original,title_ko,canonical_url,source_name,discovered_via,source_tier,verification_status,processing_status,processing_note,processed_at,embedding_status,embedded_at,headline_embedded_at,is_top10,top10_rank,published_at,created_at,body_fetched_at,summary_ko,keywords_ko,article_company(company_id),knowledge_chunk(count)";
  // company 필터는 내장 자원 필터라 inner join 표시가 필요하다.
  const selectWithJoin = company ? select.replace("article_company(company_id)", "article_company!inner(company_id)") : select;
  const path = `article?select=${selectWithJoin}${filters.length ? `&${filters.join("&")}` : ""}&order=${dateField}.desc&limit=${ARTICLE_LIST_LIMIT}`;
  const rows = await supabaseRest(path);
  return {
    articles: (rows || []).map((row) => ({
      ...row,
      chunk_count: row.knowledge_chunk?.[0]?.count ?? 0,
      knowledge_chunk: undefined,
      companies: (row.article_company || []).map((link) => link.company_id),
      article_company: undefined,
    })),
    limit: ARTICLE_LIST_LIMIT,
  };
}

// 기사 하나의 전 과정: 원문 길이, 요약, 이벤트, 청크(원문 조각·임베딩 입력·벡터 유무), 재청킹 미리보기.
async function article(query) {
  const id = safeId(query.id);
  if (!id) return { error: "invalid_id" };
  const [rows, chunks, vectors, events, feedback] = await Promise.all([
    supabaseRest(`article?select=*,article_company(company_id,company(name_ko))&id=eq.${id}&limit=1`),
    supabaseRest(`knowledge_chunk?select=id,source_type,chunk_index,chunk_total,content_ko,content_original,original_excerpt,embedding_model,created_at,company_id,event_id&article_id=eq.${id}&order=source_type.asc,chunk_index.asc`),
    supabaseRest(`knowledge_chunk?select=id&article_id=eq.${id}&embedding=not.is.null`),
    supabaseRest(`event?select=id,company_id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,entity_names,evidence_kind,timeline_eligibility,original_excerpt,original_excerpt_ko,created_at&article_id=eq.${id}&order=occurred_at.desc`),
    supabaseRest(`article_feedback?select=vote,updated_at&article_id=eq.${id}`),
  ]);
  const row = rows?.[0];
  if (!row) return { error: "not_found" };
  const withVector = new Set((vectors || []).map((v) => v.id));
  const body = row.body_original || "";
  // 지금 코드로 다시 자르면 몇 조각이 되는지. 저장된 청크 수와 다르면 청킹 규칙이 바뀐 뒤 임베딩된 것이다.
  const preview = chunkArticleBody(body);
  return {
    article: { ...row, body_original: undefined, body_length: body.length, body_head: body.slice(0, 1500), companies: (row.article_company || []).map((l) => ({ id: l.company_id, name_ko: l.company?.name_ko })) },
    chunks: (chunks || []).map((chunk) => ({ ...chunk, has_vector: withVector.has(chunk.id) })),
    events: events || [],
    feedback: feedback || [],
    rechunk_preview: { count: preview.length, lengths: preview.map((c) => c.length) },
  };
}

// 이벤트 목록. 미분류(layer null)·시점 미확인(basis null)·벡터 없음처럼 품질 신호로 거른다.
async function events(query) {
  const filters = [];
  const company = safeToken(query.company);
  if (company) filters.push(`company_id=eq.${enc(company)}`);
  const evidence = safeToken(query.evidence);
  if (evidence) filters.push(`evidence_kind=eq.${enc(evidence)}`);
  if (query.missing === "layer") filters.push("layer_key=is.null");
  if (query.missing === "basis") filters.push("occurred_basis=is.null");
  const from = day(query.from, null);
  const to = day(query.to, null);
  if (from) filters.push(`occurred_at=gte.${from}`);
  if (to) filters.push(`occurred_at=lte.${to}`);
  const q = String(query.q || "").trim().slice(0, 80);
  if (q) filters.push(`or=(title_ko.ilike.*${enc(q)}*,fact_ko.ilike.*${enc(q)}*)`);
  const limit = Math.min(300, Math.max(1, Number(query.limit) || 150));
  const rows = await supabaseRest(`event?select=id,company_id,article_id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,entity_names,evidence_kind,timeline_eligibility,source_name,source_url,created_at,knowledge_chunk(count)${filters.length ? `&${filters.join("&")}` : ""}&order=created_at.desc&limit=${limit}`);
  let list = (rows || []).map((row) => ({ ...row, chunk_count: row.knowledge_chunk?.[0]?.count ?? 0, knowledge_chunk: undefined }));
  if (query.missing === "vector") list = list.filter((row) => !row.chunk_count);
  return { events: list, limit };
}

// 최근 청크. 헤드라인·Daily·이벤트 청크가 어떤 텍스트로 임베딩되는지 본다.
async function chunks(query) {
  const filters = [];
  const type = safeToken(query.type);
  if (type) filters.push(`source_type=eq.${enc(type)}`);
  const company = safeToken(query.company);
  if (company) filters.push(`company_id=eq.${enc(company)}`);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 60));
  const rows = await supabaseRest(`knowledge_chunk?select=id,source_type,company_id,article_id,event_id,source_name,source_url,published_at,chunk_index,chunk_total,content_ko,content_original,embedding_model,created_at${filters.length ? `&${filters.join("&")}` : ""}&order=created_at.desc&limit=${limit}`);
  return { chunks: rows || [], limit };
}

// 벡터 검색 시험. 답변 생성 없이 검색 결과만 유사도와 함께 돌려준다.
async function search(query) {
  const question = String(query.q || "").trim().slice(0, 300);
  if (!question) return { error: "question_required" };
  const company = safeToken(query.company);
  const includeUnverified = String(query.unverified || "") === "1";
  const started = Date.now();
  const rows = await searchKnowledge({ question, companyId: company, limit: Math.min(20, Math.max(1, Number(query.limit) || 12)), includeUnverified });
  return {
    question, company, include_unverified: includeUnverified, ms: Date.now() - started,
    results: rows.map((row) => ({ ...row, similarity: Math.round((row.similarity || 0) * 1000) / 1000 })),
  };
}

// 고정된 보고서 한 건만 현재 추출 경로로 dry-run 한다. DB·파일·LLM/추적 로그에 쓰지 않는다.
// URL을 요청값으로 받지 않아 관리자 API가 임의 URL을 내려받는 통로가 되지 않게 한다.
async function probeDigest(query) {
  const preset = PROBE_REPORTS[String(query.report || "wanrun-2026h1")];
  if (!preset) return { error: "unknown_probe_report" };
  const company = COMPANIES.find((item) => item.id === preset.company_id);
  if (!company) throw new Error("PROBE_COMPANY_NOT_FOUND");
  const started = Date.now();
  const result = await digestReport({
    company, kind: preset.kind, knownUrl: preset.url, maxEvents: 30, timeoutMs: 120000, diagnostic: true,
  });
  const precision = {};
  for (const row of result.rows) precision[row.occurred_precision] = (precision[row.occurred_precision] || 0) + 1;
  const datedEvents = result.rows.filter((row) => row.occurred_precision === "day" || row.occurred_precision === "month").length;
  const verdict = result.rows.length <= 5 ? "현재 코드가 저장된 결과를 재현한다 → T1(추출 수정) 필수"
    : result.rows.length >= 20 ? "현재 코드는 훨씬 많이 낸다 → 저장된 행은 옛 코드 산출물. T3(재처리)로 직행"
    : "중간. 조각별 산출 건수와 dropped를 보고 판단";
  return {
    report: preset, ms: Date.now() - started,
    diagnostics: result.diagnostics, per_chunk_returned: result.per_chunk_returned, chunk_errors: result.chunk_errors,
    returned: result.returned, dropped: result.dropped, rows: result.rows.length, precision, dated_events: datedEvents,
    verdict,
    events: result.rows.map((row) => ({ occurred_at: row.occurred_at, occurred_precision: row.occurred_precision, layer_key: row.layer_key, title_ko: row.title_ko })),
  };
}

// 파이프라인 명세. 소스·프롬프트·단계·보관 정책을 실제 코드에서 읽어 그대로 돌려준다.
// 정적인 값이라 DB를 건드리지 않는다.
async function pipeline() {
  return { pipeline: pipelineManifest() };
}

async function allRows(resource, select, order = "id.asc") {
  const rows = [];
  for (let offset = 0; offset < AUDIT_MAX_ROWS; offset += AUDIT_PAGE_SIZE) {
    const batch = await supabaseRest(`${resource}?select=${select}&order=${order}&limit=${AUDIT_PAGE_SIZE}&offset=${offset}`);
    rows.push(...(batch || []));
    if (!batch || batch.length < AUDIT_PAGE_SIZE) break;
  }
  return rows;
}

// 전수 관계 검사는 서버에서 집계하고, 화면에는 수정 기능 없이 검토 후보만 돌려준다.
async function audit() {
  const [articleRows, chunkRows, eventRows] = await Promise.all([
    allRows("article", "id,title_original,title_ko,summary_ko,keywords_ko,canonical_url,source_name,source_tier,discovered_via,published_at,article_company(company_id)"),
    allRows("knowledge_chunk", "id,source_type,company_id,article_id,event_id,source_name,source_url,published_at,content_ko,content_original,original_excerpt"),
    allRows("event", "id,company_id,article_id,source_name,source_url,occurred_at"),
  ]);
  return { audit: buildDataAudit({ articles: articleRows, chunks: chunkRows, events: eventRows }) };
}

// ---------- 벡터 지식(RAG) 사람 평가 ----------
//
// 평가 대상은 두 가지다. 청크 자체의 품질과, 질문 하나에 대한 검색 결과의 정밀도.
// 판정은 rag_evaluation에만 쌓이고 파이프라인은 그것을 읽지 않는다. 자동 삭제·자동 가중치 조정은 없다.

const EVAL_SELECT = "id,subject_type,chunk_id,chunk_source_type,company_id,question,question_key,result_rank,retrieved_by,similarity,filter_company_id,include_unverified,verdict,issue_tags,note,evaluator,created_at,updated_at";

// supabase/rag-evaluation.sql을 아직 실행하지 않은 상태를 502가 아니라 화면 안내로 구분한다.
// 이 화면은 새 테이블에 의존하므로, 적용 전에 여는 것이 정상적인 경로다.
function isSchemaMissing(error) {
  const message = String(error?.message || "");
  return error?.status === 404 || message.includes("PGRST205") || message.includes("rag_evaluation");
}

async function allEvaluations(subjectType = null) {
  const filter = subjectType ? `&subject_type=eq.${enc(subjectType)}` : "";
  const rows = [];
  for (let offset = 0; offset < EVAL_ROWS_MAX; offset += AUDIT_PAGE_SIZE) {
    const batch = await supabaseRest(`rag_evaluation?select=${EVAL_SELECT}${filter}&order=updated_at.desc&limit=${AUDIT_PAGE_SIZE}&offset=${offset}`);
    rows.push(...(batch || []));
    if (!batch || batch.length < AUDIT_PAGE_SIZE) break;
  }
  return rows;
}

// 화면이 쓰는 판정·사유 목록은 lib에서 그대로 내려보낸다. 화면에 따로 적어 두면 두 곳이 갈린다.
function evalCatalog() {
  return { verdicts: VERDICTS, issue_tags: ISSUE_TAGS };
}

async function evalSummary() {
  let rows = [];
  let schemaMissing = false;
  try { rows = await allEvaluations(); }
  catch (error) { if (!isSchemaMissing(error)) throw error; schemaMissing = true; }
  // 진행률의 분모. 코퍼스 전체 건수는 개요 화면이 쓰는 집계 RPC에서 그대로 가져온다.
  const overviewData = await supabaseRest("rpc/admin_overview", { method: "POST", body: {} }).catch(() => null);
  const chunkTotals = (overviewData?.chunks_by_type || []).map((entry) => ({ source_type: entry.source_type, count: entry.count }));
  return {
    schema_missing: schemaMissing,
    catalog: evalCatalog(),
    summary: summarizeEvaluations(rows, { chunkTotals }),
    sessions: buildRetrievalSessions(rows),
  };
}

// 평가할 청크 목록. '미평가만'을 걸면 앞쪽이 이미 평가된 상태일 수 있어
// 한 페이지가 찰 때까지 뒤로 더 훑는다. 훑은 만큼을 next_offset으로 돌려줘 이어서 볼 수 있게 한다.
async function evalChunks(query) {
  let evaluations = [];
  let schemaMissing = false;
  try { evaluations = await allEvaluations("chunk"); }
  catch (error) { if (!isSchemaMissing(error)) throw error; schemaMissing = true; }
  const byChunk = new Map(evaluations.map((row) => [row.chunk_id, row]));

  const filters = [];
  const type = safeToken(query.type);
  if (type) filters.push(`source_type=eq.${enc(type)}`);
  const company = safeToken(query.company);
  if (company) filters.push(`company_id=eq.${enc(company)}`);
  const q = String(query.q || "").trim().slice(0, 80);
  if (q) filters.push(`or=(content_ko.ilike.*${enc(q)}*,original_excerpt.ilike.*${enc(q)}*)`);
  const noVector = String(query.novector || "") === "1";
  if (noVector) filters.push("embedding=is.null");

  const state = ["none", "done", "good", "partial", "bad"].includes(query.state) ? query.state : "";
  const keep = (chunk) => {
    const evaluation = byChunk.get(chunk.id);
    if (state === "none") return !evaluation;
    if (state === "done") return Boolean(evaluation);
    if (state) return evaluation?.verdict === state;
    return true;
  };

  const limit = Math.min(120, Math.max(1, Number(query.limit) || EVAL_PAGE_SIZE));
  const startOffset = Math.max(0, Number(query.offset) || 0);
  const select = "id,source_type,company_id,article_id,event_id,source_name,source_url,published_at,chunk_index,chunk_total,content_ko,content_original,original_excerpt,embedding_model,created_at";
  const matched = [];
  let offset = startOffset;
  let scanned = 0;
  let exhausted = false;
  while (matched.length < limit && scanned < EVAL_SCAN_MAX) {
    const path = `knowledge_chunk?select=${select}${filters.length ? `&${filters.join("&")}` : ""}&order=created_at.desc,id.asc&limit=${EVAL_SCAN_PAGE}&offset=${offset}`;
    const batch = (await supabaseRest(path)) || [];
    scanned += batch.length;
    offset += batch.length;
    for (const chunk of batch) {
      if (matched.length >= limit) break;
      if (keep(chunk)) matched.push(chunk);
    }
    if (batch.length < EVAL_SCAN_PAGE) { exhausted = true; break; }
  }

  return {
    schema_missing: schemaMissing,
    catalog: evalCatalog(),
    chunks: matched.map((chunk) => ({ ...chunk, evaluation: byChunk.get(chunk.id) || null })),
    limit,
    scanned,
    next_offset: exhausted ? null : offset,
    evaluated_total: byChunk.size,
  };
}

// 검색 평가 화면이 쓰는 검색. 벡터 검색 시험과 같은 경로를 그대로 부르되,
// 이미 이 질문으로 매긴 판정을 근거마다 붙여 돌려준다.
async function evalSearch(query) {
  const question = String(query.q || "").trim().slice(0, 300);
  if (!question) return { error: "question_required" };
  const company = safeToken(query.company);
  const includeUnverified = String(query.unverified || "") === "1";
  const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
  const started = Date.now();
  const rows = await searchKnowledge({ question, companyId: company, limit, includeUnverified });

  let prior = [];
  let schemaMissing = false;
  const key = questionKey({ question, companyId: company, includeUnverified });
  try { prior = await supabaseRest(`rag_evaluation?select=${EVAL_SELECT}&subject_type=eq.retrieval&question_key=eq.${enc(key)}`); }
  catch (error) { if (!isSchemaMissing(error)) throw error; schemaMissing = true; }
  const byChunk = new Map((prior || []).map((row) => [row.chunk_id, row]));

  return {
    schema_missing: schemaMissing,
    catalog: evalCatalog(),
    question, question_key: key, company, include_unverified: includeUnverified, ms: Date.now() - started,
    retrieval: rows.retrieval || null,
    results: rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      similarity: Math.round((row.similarity || 0) * 1000) / 1000,
      evaluation: byChunk.get(row.id) || null,
    })),
  };
}

// 판정 저장. 같은 대상을 다시 매기면 새 행을 쌓지 않고 기존 행을 덮어쓴다.
// 부분 유니크 인덱스는 PostgREST의 on_conflict로 지정할 수 없어, 먼저 찾아보고 갱신/삽입을 나눈다.
async function evalSave(body) {
  let row;
  try { row = buildEvaluationRow(body); }
  catch (error) { return { error: error.reason || "invalid_input" }; }

  const filter = row.subject_type === "chunk"
    ? `subject_type=eq.chunk&chunk_id=eq.${enc(row.chunk_id)}&evaluator=eq.${enc(row.evaluator)}`
    : `subject_type=eq.retrieval&question_key=eq.${enc(row.question_key)}&chunk_id=eq.${enc(row.chunk_id)}&evaluator=eq.${enc(row.evaluator)}`;
  const existing = await supabaseRest(`rag_evaluation?select=id&${filter}&limit=1`);
  const now = new Date().toISOString();
  const saved = existing?.[0]
    ? await supabaseRest(`rag_evaluation?id=eq.${enc(existing[0].id)}&select=${EVAL_SELECT}`, { method: "PATCH", body: { ...row, updated_at: now } })
    : await supabaseRest(`rag_evaluation?select=${EVAL_SELECT}`, { method: "POST", body: { ...row, created_at: now, updated_at: now } });
  return { evaluation: saved?.[0] || null, replaced: Boolean(existing?.[0]) };
}

// 판정 취소. 평가 행 하나만 지운다. 대상 청크·이벤트·기사는 건드리지 않는다.
async function evalDelete(body) {
  const id = safeId(body.id);
  if (!id) return { error: "invalid_id" };
  const removed = await supabaseRest(`rag_evaluation?id=eq.${enc(id)}&select=id`, { method: "DELETE" });
  return { deleted: (removed || []).length };
}

export default async function handler(request, response) {
  if (!requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
  const view = String(request.query?.view || "overview");

  // 쓰기는 평가 저장·취소 두 가지뿐이다. 나머지 화면은 GET 전용으로 남긴다.
  if (request.method === "POST") {
    const writers = { "eval-save": evalSave, "eval-delete": evalDelete };
    const write = writers[view];
    if (!write) return response.status(400).json({ status: "unknown_view", view });
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
    try {
      const payload = await write(body);
      response.setHeader("Cache-Control", "no-store, max-age=0");
      if (payload.error) return response.status(400).json({ status: payload.error });
      return response.status(200).json({ status: "ok", view, ...payload });
    } catch (error) {
      console.error("[ADMIN_WRITE_FAILED]", JSON.stringify({ view, message: error.message }));
      const missing = isSchemaMissing(error);
      return response.status(missing ? 409 : 502).json({
        status: missing ? "eval_schema_missing" : "admin_write_failed", view,
        message: missing ? "supabase/rag-evaluation.sql을 아직 실행하지 않았습니다." : String(error.message || error).slice(0, 400),
      });
    }
  }
  if (request.method !== "GET") return response.status(405).json({ status: "method_not_allowed" });

  const handlers = {
    overview, audit, runs, articles, article, events, chunks, search, pipeline, "probe-digest": probeDigest,
    "eval-summary": evalSummary, "eval-chunks": evalChunks, "eval-search": evalSearch,
  };
  const run = handlers[view];
  if (!run) return response.status(400).json({ status: "unknown_view", view });
  try {
    const payload = await run(request.query || {});
    response.setHeader("Cache-Control", "no-store, max-age=0");
    if (payload.error) return response.status(payload.error === "not_found" ? 404 : 400).json({ status: payload.error });
    return response.status(200).json({ status: "ok", view, ...payload });
  } catch (error) {
    console.error("[ADMIN_QUERY_FAILED]", JSON.stringify({ view, message: error.message }));
    return response.status(502).json({ status: "admin_query_failed", view, message: String(error.message || error).slice(0, 400) });
  }
}
