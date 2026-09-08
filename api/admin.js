// 관리자 페이지(품질 점검) 조회 API.
//
// 화면에 보이지 않는 중간 산출물을 그대로 보여 준다: 어느 검색 경로가 무엇을 찾았는지,
// 본문 처리가 왜 실패했는지, 기사 하나가 몇 개 청크로 어떻게 잘렸는지, 임베딩이 붙었는지,
// 벡터 검색이 어떤 질문에 무엇을 돌려주는지. 읽기 전용이며 입장 세션으로만 연다.
import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { requireAccess } from "../lib/access.js";
import { searchKnowledge } from "../lib/knowledge-search.js";
import { chunkArticleBody } from "../lib/vector-ingestion.js";
import { pipelineManifest } from "../lib/pipeline-manifest.js";
import { buildDataAudit } from "../lib/data-audit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ARTICLE_LIST_LIMIT = 200;
const AUDIT_PAGE_SIZE = 500;
const AUDIT_MAX_ROWS = 10000;

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

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ status: "method_not_allowed" });
  if (!requireAccess(request, response)) return;
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured" });
  const view = String(request.query?.view || "overview");
  const handlers = { overview, audit, runs, articles, article, events, chunks, search, pipeline };
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
