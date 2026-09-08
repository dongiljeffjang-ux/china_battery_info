import crypto from "node:crypto";
import { supabaseRest } from "./supabase.js";
import { translateArticleKo } from "./article-translation.js";

const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 180;
const MAX_CHUNKS = 24;
// 정기보고서는 원문 전체를 넣는다. 연차보고서 한 건이 20만~60만 자라
// 60만 자 ÷ 1,800자 ≈ 340조각이면 덮는다. 여유를 둬 400으로 잡는다.
const MAX_REPORT_CHUNKS = 400;
// 한 번의 함수 실행(60초)에서 만들 조각 수 상한. 큰 보고서는 여러 훅에 나눠 넣는다.
const REPORT_CHUNKS_PER_HOP = 120;
// 임베딩 요청 하나에 넣는 조각 수. OpenAI 임베딩은 요청당 입력 수와 토큰에 한도가 있어
// 조각 수백 개를 한 요청에 담으면 거부된다. 나눠 보낸다.
const EMBED_BATCH_SIZE = 64;

function splitAtBoundary(text, start) {
  const ceiling = Math.min(text.length, start + CHUNK_CHARS);
  if (ceiling === text.length) return ceiling;
  const boundary = Math.max(text.lastIndexOf("\n", ceiling), text.lastIndexOf("。", ceiling), text.lastIndexOf(". ", ceiling));
  return boundary > start + Math.floor(CHUNK_CHARS * 0.55) ? boundary + 1 : ceiling;
}

// 줄 구조를 지키며 자른다. 표 행은 절대 중간에서 쪼개지 않고, 표가 여러 청크에 걸치면
// 청크마다 헤더 행을 다시 붙인다. 그래야 조각 하나만 봐도 어느 숫자가 어느 열인지 알 수 있다.
// 산문은 줄(문단) 단위로 담는다.
export function chunkStructuredText(body = "", maxChunks = MAX_REPORT_CHUNKS) {
  const lines = String(body).split("\n").map((line) => line.trim()).filter(Boolean);
  const isRow = (line) => (line.match(/ \| /g) || []).length >= 2;
  const chunks = [];
  let buffer = [];
  let header = null;
  let inTable = false;
  for (const line of lines) {
    if (isRow(line)) {
      // 표가 시작되는 첫 행을 헤더로 본다.
      if (!inTable) { inTable = true; header = line; }
    } else {
      inTable = false;
      header = null;
    }
    const current = buffer.join("\n");
    if (buffer.length && current.length + line.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      buffer = [];
      // 표 중간에서 새 청크가 시작되면 헤더를 먼저 넣는다.
      if (inTable && header && header !== line) buffer.push(header);
    }
    buffer.push(line);
  }
  if (buffer.length) chunks.push(buffer.join("\n"));
  return chunks.slice(0, maxChunks);
}

export function chunkArticleBody(body = "", maxChunks = MAX_CHUNKS) {
  const text = String(body).replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < text.length && chunks.length < maxChunks;) {
    const end = splitAtBoundary(text, start);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

async function createEmbeddings(inputs) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!apiKey) throw new Error("EMBEDDING_NOT_CONFIGURED");
  const embeddings = [];
  // 조각 수백 개를 한 요청에 담으면 입력 수·토큰 한도에 걸린다. 나눠 보내고 순서대로 잇는다.
  for (let offset = 0; offset < inputs.length; offset += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + EMBED_BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: batch, encoding_format: "float" })
    });
    if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
    const payload = await response.json();
    const part = (payload.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (part.length !== batch.length || part.some((item) => !item?.length)) throw new Error("INVALID_EMBEDDING_RESPONSE");
    embeddings.push(...part);
  }
  return { model, embeddings };
}

// 생성된 Daily 리포트를 벡터 검색 대상으로 만든다.
// 한 번 만든 결과를 다시 만들지 않고 재사용하고, 나중에 다른 서비스에서도 쓰기 위함이다.
// 사실(summary)과 해석(insight)은 검색 목적이 달라 청크를 나눈다.
export async function embedDailyReport({ reportDate, summaryKo, insightKo }) {
  const parts = [
    summaryKo ? { kind: "사실", text: summaryKo } : null,
    insightKo ? { kind: "해석", text: insightKo } : null,
  ].filter(Boolean);
  if (!parts.length) return { chunks: 0, status: "skipped" };
  const inputs = parts.map((part) => `[Daily 리포트 ${part.kind}] ${reportDate}\n${part.text}`);
  const { model, embeddings } = await createEmbeddings(inputs);
  const rows = parts.map((part, index) => ({
    company_id: null,
    source_type: "daily_report",
    source_url: `https://china-battery-lens.vercel.app/?report=${reportDate}`,
    source_name: `China Battery Lens Daily ${reportDate} · ${part.kind}`,
    published_at: reportDate,
    content_ko: inputs[index],
    chunk_index: index,
    chunk_total: parts.length,
    content_hash: crypto.createHash("sha256").update(`daily:${reportDate}:${part.kind}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows
  });
  return { chunks: rows.length, status: "embedded", model };
}

// 기업 시계열 이벤트를 벡터 검색 대상으로 만든다.
// 기사 본문 청크와 달리 이벤트는 이미 한국어 팩트로 압축돼 있으므로 한 건이 곧 한 청크다.
// 회사별 검색이 되도록 company_id를 채우고, 원문 발췌를 함께 넣어 근거 인용이 가능하게 한다.
function eventTimeLabel(event) {
  const raw = String(event.occurred_at || "").slice(0, 10);
  const [year, month] = raw.split("-").map(Number);
  const precision = event.occurred_precision || "day";
  let label = raw || "시점 미상";
  if (precision === "year" && year) label = `${year}년 중`;
  if (precision === "half" && year) label = `${year}년 ${month <= 6 ? "상반기" : "하반기"}`;
  if (precision === "month" && year && month) label = `${year}년 ${month}월`;
  const basis = String(event.occurred_basis || "").trim().slice(0, 40);
  return `[시점] ${label}${basis ? ` (${basis})` : ""}`;
}

function eventCounterparties(event) {
  const facts = Array.isArray(event.event_fact) ? event.event_fact : event.event_fact ? [event.event_fact] : [];
  return [...new Set(facts.map((fact) => String(fact?.counterparty || "").trim()).filter(Boolean))];
}

export function buildEventEmbeddingText(event) {
  const counterparties = eventCounterparties(event);
  return [
    `[회사] ${event.company_name_ko || event.company_id}`,
    eventTimeLabel(event),
    `[구분] ${event.trajectory_track === "technology" ? "기술" : event.trajectory_track === "both" ? "시장·기술" : "시장"}${event.layer_key ? ` / ${event.layer_key}` : ""}`,
    event.entity_names?.length ? `[발생 법인] ${event.entity_names.join(", ")}` : "",
    counterparties.length ? `[상대] ${counterparties.join(", ")}` : "",
    `[사실] ${event.title_ko}`,
    event.fact_ko,
    event.original_excerpt_ko ? `[원문 번역] ${event.original_excerpt_ko}` : "",
  ].filter(Boolean).join("\n");
}

export async function embedEvents(events = []) {
  const rows = events.filter((event) => event.title_ko && event.fact_ko);
  if (!rows.length) return { chunks: 0, status: "skipped" };
  const inputs = rows.map(buildEventEmbeddingText);
  const { model, embeddings } = await createEmbeddings(inputs);
  const chunks = rows.map((event, index) => ({
    company_id: event.company_id,
    article_id: event.article_id || null,
    event_id: event.id,
    source_type: "event_fact",
    source_url: event.source_url,
    source_name: event.source_name,
    published_at: event.occurred_at ? String(event.occurred_at).slice(0, 10) : null,
    original_excerpt: event.original_excerpt,
    content_ko: inputs[index],
    content_hash: crypto.createHash("sha256").update(`event:${event.id}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: chunks
  });
  return { chunks: chunks.length, status: "embedded", model };
}

// 본문 검증을 거치지 않은 수집 기사의 제목을 벡터 검색 대상으로 만든다.
//
// 하루에 수백 건이 수집되지만 본문을 읽는 것은 상위 몇십 건뿐이라, 나머지는 벡터 지식에서
// 통째로 빠져 있었다. 제목만이라도 넣어 "그런 소식이 있었는지"는 찾을 수 있게 한다.
// 본문 근거가 아니므로 source_type을 headline으로 따로 두고, 검색은 기본적으로 이를 제외한다.
// 원문 제목은 중국어라 한국어 질문과 매칭되지 않으므로 번역된 제목을 함께 넣는다.
export async function embedHeadlines(items = []) {
  const rows = items.filter((item) => item.id && item.titleKo);
  if (!rows.length) return { chunks: 0, status: "skipped" };
  const inputs = rows.map((item) => [
    `[미검증 헤드라인] ${item.sourceName || "출처 미상"} · ${item.publishedAt ? String(item.publishedAt).slice(0, 10) : "시점 미상"}`,
    item.companyName ? `[회사] ${item.companyName}` : "",
    `[제목] ${item.titleKo}`,
    item.keywordsKo?.length ? `[키워드] ${item.keywordsKo.join(", ")}` : "",
    `[원문 제목] ${item.titleOriginal || ""}`,
  ].filter(Boolean).join("\n"));
  const { model, embeddings } = await createEmbeddings(inputs);
  const chunks = rows.map((item, index) => ({
    company_id: item.companyId || null,
    article_id: item.id,
    source_type: "headline",
    source_url: item.sourceUrl,
    source_name: item.sourceName,
    published_at: item.publishedAt ? String(item.publishedAt).slice(0, 10) : null,
    original_excerpt: item.titleOriginal || null,
    content_ko: inputs[index],
    chunk_index: 0,
    chunk_total: 1,
    content_hash: crypto.createHash("sha256").update(`headline:${item.id}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: chunks
  });
  return { chunks: chunks.length, status: "embedded", model };
}

export async function embedVerifiedArticle({ article, companyId, bodyText, summaryKo, titleKo, sourceUrl, sourceName, publishedAt, keepOriginal = true }) {
  // 언론 기사 원문은 남의 저작물이라 우리 DB에 남기지 않는다(keepOriginal=false). 그때는 읽고
  // 정리한 한국어 요약만 임베딩하고 본문은 지운다. 세부까지 검색되지는 않지만 화면에 보이는 것과
  // 같은 내용이고, 원문이 필요하면 링크로 간다. 거래소 공시는 공개 자료라 원문을 그대로 남긴다.
  if (!keepOriginal) {
    const summaryHeader = `[한국어 팩트 요약]
${titleKo || article.title_original}
${summaryKo || ""}`.trim();
    if (summaryHeader.length < 20) return { chunks: 0, status: "skipped" };
    // 원문은 버리되 한국어로 옮긴 본문을 문단 단위로 남긴다. 예전에는 제목과 요약 한 조각만 넣어
    // 기사 속 세부 사실이 검색되지 않았다. 번역이 실패하면 예전처럼 요약 한 조각으로 간다.
    const translation = await translateArticleKo({
      bodyText, titleOriginal: article.title_original, companyNameKo: article.company_name_ko || companyId,
    });
    const bodyChunks = translation.paragraphs.length
      ? chunkStructuredText(translation.paragraphs.join("\n"), MAX_CHUNKS)
      : [];
    const inputs = bodyChunks.length
      ? bodyChunks.map((chunk) => `${summaryHeader}\n\n[한국어 본문]\n${chunk}`)
      : [summaryHeader];
    const { model, embeddings } = await createEmbeddings(inputs);
    const rows = inputs.map((content, index) => ({
      company_id: companyId, article_id: article.id, source_type: "article_chunk",
      source_url: sourceUrl, source_name: sourceName,
      published_at: publishedAt ? String(publishedAt).slice(0, 10) : null,
      content_ko: content, content_original: null, chunk_index: index, chunk_total: inputs.length,
      content_hash: crypto.createHash("sha256").update(bodyChunks.length ? `${article.id}:ko:${index}:${content}` : `${article.id}:ko`).digest("hex"),
      embedding: embeddings[index], embedding_model: model,
    }));
    // 같은 기사를 다시 임베딩하면 예전 조각(요약 한 조각)이 남아 겹친다. 이 기사의 조각을 비우고 새로 넣는다.
    await supabaseRest(`knowledge_chunk?article_id=eq.${encodeURIComponent(article.id)}&source_type=eq.article_chunk`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows,
    });
    await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
      method: "PATCH", prefer: "return=minimal",
      // 임베딩이 끝났으면 원문을 지운다. 실패해 다시 시도할 때까지만 들고 있는다.
      body: { embedding_status: "embedded", embedded_at: new Date().toISOString(), body_original: null, updated_at: new Date().toISOString() },
    });
    return { chunks: rows.length, status: "embedded", model, translation: translation.status, truncated: translation.truncated || false };
  }
  const originalChunks = chunkArticleBody(bodyText);
  if (!originalChunks.length) return { chunks: 0, status: "skipped" };
  // Korean fact summary is deliberately repeated in every chunk. This keeps
  // Korean retrieval effective while preserving the complete Chinese/English
  // source body without paying to translate every paragraph.
  const header = `[한국어 팩트 요약]\n${titleKo || article.title_original}\n${summaryKo || ""}\n\n[원문 근거 청크]\n`;
  const inputs = originalChunks.map((chunk) => `${header}${chunk}`);
  const { model, embeddings } = await createEmbeddings(inputs);
  const total = originalChunks.length;
  const rows = originalChunks.map((chunk, index) => ({
    company_id: companyId,
    article_id: article.id,
    source_type: "article_chunk",
    source_url: sourceUrl,
    source_name: sourceName,
    published_at: publishedAt ? String(publishedAt).slice(0, 10) : null,
    content_ko: inputs[index],
    content_original: chunk,
    chunk_index: index,
    chunk_total: total,
    content_hash: crypto.createHash("sha256").update(`${article.id}:${index}:${chunk}`).digest("hex"),
    embedding: embeddings[index],
    embedding_model: model
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows
  });
  await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
    method: "PATCH", body: { embedding_status: "embedded", embedded_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  });
  return { chunks: total, status: "embedded", model };
}

// 정기보고서 원문을 잘라 벡터에 넣는다.
//
// 지금까지 보고서는 사실 몇 줄만 뽑고 본문 수십만 자를 버렸다. 226쪽 연차보고서에서 14줄만
// 남으니 거기 없는 내용은 검색으로 찾을 수 없었다. 거래소에 공개된 자료라 보관에 문제가 없으므로
// 원문 전체를 넣는다. 예전에는 관리층 논의·중요사항 구간만 넣었으나, 그 밖의 구간(사업 개요,
// 위험 요인, 주주·지배구조, 재무 수치)에도 찾고 싶은 사실이 있어 전문을 대상으로 바꿨다.
//
// 큰 보고서는 한 번의 함수 실행(60초)에 다 넣지 못한다. 이미 저장된 조각 번호를 보고
// 이어서 넣으며, 남은 수를 돌려줘 다음 훅이 이어받게 한다.
export async function embedReportChunks({ companyId, companyNameKo, reportUrl, reportTitle, publishedAt, section, text }) {
  // 전문이 있으면 전문을, 없으면 예전처럼 분석 구간을 넣는다.
  const body = (text && text.length > (section || "").length) ? text : section;
  const chunks = chunkStructuredText(body, MAX_REPORT_CHUNKS);
  if (!chunks.length) return { chunks: 0, status: "skipped", remaining: 0 };
  const stored = await supabaseRest(`knowledge_chunk?select=chunk_index&source_type=eq.report_chunk&source_url=eq.${encodeURIComponent(reportUrl)}`);
  const done = new Set((stored || []).map((row) => row.chunk_index));
  const todo = chunks.map((chunk, index) => ({ chunk, index })).filter((item) => !done.has(item.index));
  if (!todo.length) return { chunks: 0, status: "embedded", remaining: 0 };
  const batch = todo.slice(0, REPORT_CHUNKS_PER_HOP);
  // 어느 회사 어느 보고서에서 나온 대목인지 조각마다 붙인다. 한국어 질문으로도 걸리게 하려는 것이다.
  const header = `[정기보고서] ${companyNameKo || companyId} · ${reportTitle || ""}${publishedAt ? ` (공시일 ${publishedAt})` : ""}

`;
  const inputs = batch.map((item) => `${header}${item.chunk}`);
  const { model, embeddings } = await createEmbeddings(inputs);
  const rows = batch.map((item, position) => ({
    company_id: companyId,
    source_type: "report_chunk",
    source_url: reportUrl,
    source_name: reportTitle || "정기보고서",
    published_at: publishedAt ? String(publishedAt).slice(0, 10) : null,
    content_ko: inputs[position],
    content_original: item.chunk,
    chunk_index: item.index,
    chunk_total: chunks.length,
    content_hash: crypto.createHash("sha256").update(`report:${reportUrl}:${item.index}:${item.chunk}`).digest("hex"),
    embedding: embeddings[position],
    embedding_model: model,
  }));
  await supabaseRest("knowledge_chunk?on_conflict=content_hash", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows,
  });
  return { chunks: rows.length, status: "embedded", model, remaining: todo.length - batch.length, total: chunks.length };
}
