// 과거 기업 시계열 백필.
//
// 회사 1곳당 웹 검색 1회로 과거 주요 사실을 받아 event 행 후보를 만든다.
// 본문 정독·교차검증을 거치지 않으므로 timeline_eligibility는 reference로 고정한다.
// 나중에 공시로 확인되면 core로 승격한다.
//
// api/ingest-rss.js(Vercel 키 사용)와 scripts/backfill-events.mjs(로컬)가 함께 쓴다.

import { createJsonResponse } from "./llm-provider.js";
import { groupSearchEntities, matchGroupEntities } from "./company-groups.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "./timeline-layers.js";
import { REPORT_KINDS, readReport } from "./report-reader.js";

function eventSchema(maxEvents) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["events"],
    properties: {
      events: {
        type: "array",
        maxItems: maxEvents,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["occurred_at", "occurred_precision", "occurred_basis", "title_ko", "fact_ko", "trajectory_track", "layer_key", "region_scope", "source_url", "source_name", "original_excerpt", "original_excerpt_ko"],
          properties: {
            occurred_at: { type: "string" },
            occurred_precision: { type: "string", enum: ["day", "month", "half", "year"] },
            occurred_basis: { type: "string" },
            title_ko: { type: "string" },
            fact_ko: { type: "string" },
            trajectory_track: { type: "string", enum: ["market", "technology", "both"] },
            layer_key: { type: "string", enum: LAYER_ENUM },
            region_scope: { type: ["string", "null"] },
            source_url: { type: "string" },
            source_name: { type: "string" },
            original_excerpt: { type: "string" },
            original_excerpt_ko: { type: "string" },
          },
        },
      },
    },
  };
}

const INSTRUCTIONS = [
  "중국 배터리 산업 리서처다. 웹 검색으로 특정 회사의 과거 주요 사실을 모은다.",
  "검색 결과에 실제로 제시된 원문 기사·공시 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다.",
  "출처에 명시된 사실만 한국어로 쓴다. 전망·인과 추정·성공 가능성·투자 판단을 만들지 않는다.",
  "occurred_at은 사건이 일어난 날짜를 YYYY-MM-DD로 쓴다. 기사 발행일이 아니라 본문이 말하는 사건일을 우선한다. 날짜가 불명확한 항목은 반환하지 않는다.",
  "occurred_precision은 그 날짜를 어디까지 믿을 수 있는지다. 날짜까지 확인되면 day, 월까지면 month, 반기까지면 half, 연간 집계면 year를 쓴다.",
  "occurred_basis에는 그 날짜를 그렇게 정한 근거를 한 문장으로 쓴다.",
  "original_excerpt에는 근거가 되는 원문을 300자 이내로 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다.",
  "본문에 마크다운 링크나 인용 표기를 넣지 않는다. 출처는 source_url 필드에만 쓴다.",
  "같은 사건을 중복해 넣지 않는다. 시기가 고르게 분포하도록 서로 다른 분기의 사실을 우선한다.",
  "주가 단신, 애널리스트 목표주가, 자동차 소비자 리뷰, 광고는 제외한다.",
  LAYER_PROMPT_GUIDE,
].join(" ");

// 모델이 사실 문장 끝에 ([catl.com](https://...)) 같은 인용을 붙인다.
// 출처는 source_url로 따로 저장하므로 본문에서는 걷어낸다.
export function stripCitations(value) {
  return String(value || "")
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return value;
  }
}

function hostnameOf(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.hostname : null;
  } catch {
    return null;
  }
}

export async function backfillCompanyEvents({ company, since, until, maxEvents = 20, provider = "auto" }) {
  const entities = groupSearchEntities(company.id);
  const names = [company.name_zh, company.name_en].filter(Boolean).join(" / ");
  const groupLine = entities.length ? `\n같은 그룹의 주요 계열사도 함께 찾는다: ${entities.join(" / ")}` : "";
  const result = await createJsonResponse({
    name: "company_timeline_backfill",
    schema: eventSchema(maxEvents),
    webSearch: true,
    instructions: INSTRUCTIONS,
    input: `회사: ${company.name_ko} [${names}]${groupLine}\n기간: ${since} ~ ${until}\n이 기간에 이 회사(또는 명시된 계열사)에서 실제로 일어난 주요 사실을 최대 ${maxEvents}건 찾으세요. 증설·가동·생산능력, 고객 인증·수주·공급계약, 제품·기술·특허, 실적·가격, 해외 진출·현지 법인을 우선합니다.`,
    provider,
  });

  const citations = new Set((result.sourceUrls || []).map(hostnameOf).filter(Boolean));
  const rows = [];
  const dropped = { badDate: 0, badUrl: 0, uncited: 0 };
  for (const event of result.data.events || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.occurred_at) || event.occurred_at < since || event.occurred_at > until) {
      dropped.badDate += 1;
      continue;
    }
    const host = hostnameOf(event.source_url);
    if (!host) {
      dropped.badUrl += 1;
      continue;
    }
    // 검색이 실제로 인용한 도메인만 채택한다. 모델이 URL을 지어내는 것을 막는 장치다.
    if (citations.size && !citations.has(host)) {
      dropped.uncited += 1;
      continue;
    }
    const title = stripCitations(event.title_ko);
    const fact = stripCitations(event.fact_ko);
    if (!title || !fact) {
      dropped.badUrl += 1;
      continue;
    }
    rows.push({
      company_id: company.id,
      occurred_at: event.occurred_at,
      occurred_precision: event.occurred_precision || "day",
      occurred_basis: event.occurred_basis || null,
      title_ko: title,
      fact_ko: fact,
      trajectory_track: event.trajectory_track,
      layer_key: normalizeLayerKey(event.layer_key),
      region_scope: event.region_scope || null,
      source_url: cleanUrl(event.source_url),
      source_name: event.source_name,
      original_excerpt: stripCitations(event.original_excerpt),
      original_excerpt_ko: stripCitations(event.original_excerpt_ko),
      timeline_eligibility: "reference",
      evidence_kind: "web_backfill",
      entity_names: matchGroupEntities(company.id, `${title} ${fact} ${event.original_excerpt}`),
    });
  }
  return { rows, dropped, returned: (result.data.events || []).length, provider: result.provider };
}

// 정기보고서 원문을 읽어 핵심 사실을 간추린다.
// 웹 검색을 쓰지 않으므로 모델이 URL을 지어낼 수 없고, 출처는 항상 그 보고서다.
const DIGEST_INSTRUCTIONS = [
  "중국 배터리 산업 애널리스트다. 제공된 거래소 정기보고서 원문에서 이 회사(또는 명시된 계열사)에 관한 사실을 빠짐없이 뽑는다.",
  "원문에 적힌 사실만 쓴다. 원문에 없는 수치·연도·회사명을 만들지 않는다. 전망·목표·전략 서술은 넣지 않는다.",
  "수치가 붙은 사실은 빠짐없이 뽑는다: 생산능력(기지별·품목별), 출하량·판매량, 가동률, 증설·프로젝트 투자액과 진척, 주요 고객·수주·공급계약(상대방 이름), 신제품 스펙과 양산 단계, 인증, 매출·이익·부문별 매출, 해외 법인·공장, 특허 수, 모집자금 프로젝트 진척, 대형 계약.",
  "수치가 없는 서술은 사업 궤적을 바꾸는 것(신규 고객 확보, 신규 거점, 신제품 양산 개시, 인증 획득, 합작·인수)만 남긴다. 회사 소개, 업계 통계, 정책 인용, 리스크 서술은 넣지 않는다.",
  "같은 사실을 표현만 바꿔 여러 건으로 만들지 않는다. 한 문장에 기지별 수치가 여럿이면 기지마다 한 건으로 나눈다.",
  "occurred_at과 occurred_precision은 이 사실이 언제의 것인지를 나타낸다. 두 종류를 반드시 구분한다.",
  "기간 집계(연간 매출, 연간 판매량, 기간 말 생산능력처럼 한 기간을 합산하거나 기간 말 기준으로 잰 값)는 occurred_at에 보고 기간 말일을 쓰고 occurred_precision을 year 또는 half로 둔다. 특정 하루에 일어난 일이 아니기 때문이다.",
  "시점 사건(투산·가동 개시, 착공, 신제품 출시, 고객 인증 획득, 계약 체결, 양산 개시처럼 특정 시점에 일어난 일)은 원문에 적힌 실제 발생일을 쓴다. 원문이 날짜까지 밝히면 occurred_precision을 day로, 월까지만 밝히면 그 달 1일과 month로, 상반기·하반기까지만 밝히면 그 반기 말일과 half로 둔다. 보고 기간 말일로 밀어 넣지 않는다.",
  "원문이 시점 사건의 시기를 전혀 밝히지 않으면 보고 기간 말일과 year를 쓰되, occurred_basis에 원문에 시점 표기가 없었다고 적는다.",
  "occurred_basis에는 그 날짜를 그렇게 정한 근거를 한 문장으로 쓴다(예: 원문에 2025년 3월 발표로 적힘 / 연간 집계라 기간 말일 사용).",
  "original_excerpt에는 근거가 된 보고서 원문을 300자 이내로 그대로 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다.",
  "source_url과 source_name은 빈 문자열로 둔다. 서버가 보고서 정보로 채운다.",
  "본문에 마크다운 링크나 인용 표기를 넣지 않는다.",
  LAYER_PROMPT_GUIDE,
].join(" ");

// 보고서 본문을 한 번에 넣으면 앞부분에 치우쳐 뒤쪽 사실을 빠뜨린다.
// 문단 경계에서 청크로 나눠 각각 뽑고, 같은 사실이 두 청크에 걸쳐 두 번 나오면 하나로 합친다.
const DIGEST_CHUNK_CHARS = 12000;

function splitSection(text, size = DIGEST_CHUNK_CHARS) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + size * 0.5) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function eventDedupeKey(event) {
  return String(event.title_ko || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

export async function digestReport({ company, kind = "annual", knownUrl = null, maxEvents = 10, provider = "auto" }) {
  const report = await readReport(company, { kind, knownUrl });
  const entities = groupSearchEntities(company.id);
  const groupLine = entities.length ? `\n이 회사의 주요 계열사: ${entities.join(" / ")}` : "";
  const header = `회사: ${company.name_ko} [${company.name_zh}]${groupLine}\n보고서: ${report.title || REPORT_KINDS[kind]?.label_ko}${report.published_at ? ` (공시일 ${report.published_at})` : ""}`;
  const chunks = splitSection(report.section);
  const parts = await Promise.all(chunks.map((chunk, index) => createJsonResponse({
    name: "company_report_digest",
    schema: eventSchema(maxEvents),
    instructions: DIGEST_INSTRUCTIONS,
    input: `${header}\n(원문 ${index + 1}/${chunks.length} 부분)\n\n--- 보고서 원문 발췌 ---\n${chunk}`,
    provider,
  })));
  const merged = new Map();
  for (const part of parts) {
    for (const event of part.data.events || []) {
      const key = eventDedupeKey(event);
      if (key && !merged.has(key)) merged.set(key, event);
    }
  }
  const result = { data: { events: [...merged.values()] }, provider: parts[0]?.provider };

  const evidenceKind = kind === "annual" ? "annual_report" : "periodic_report";
  const reportName = `${company.name_ko} ${report.title || REPORT_KINDS[kind]?.label_ko || "정기보고서"}`;
  const rows = [];
  const dropped = { badDate: 0, empty: 0 };
  for (const event of result.data.events || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.occurred_at)) {
      dropped.badDate += 1;
      continue;
    }
    const title = stripCitations(event.title_ko);
    const fact = stripCitations(event.fact_ko);
    if (!title || !fact) {
      dropped.empty += 1;
      continue;
    }
    rows.push({
      company_id: company.id,
      occurred_at: event.occurred_at,
      occurred_precision: event.occurred_precision || "day",
      occurred_basis: event.occurred_basis || null,
      title_ko: title,
      fact_ko: fact,
      trajectory_track: event.trajectory_track,
      layer_key: normalizeLayerKey(event.layer_key),
      region_scope: event.region_scope || null,
      // 출처는 모델이 아니라 서버가 정한다. 읽은 보고서 그 자체다.
      source_url: report.url,
      source_name: reportName,
      original_excerpt: stripCitations(event.original_excerpt),
      original_excerpt_ko: stripCitations(event.original_excerpt_ko),
      timeline_eligibility: "core",
      evidence_kind: evidenceKind,
      entity_names: matchGroupEntities(company.id, `${title} ${fact} ${event.original_excerpt}`),
    });
  }
  return { rows, dropped, returned: (result.data.events || []).length, provider: result.provider, report: { url: report.url, title: report.title, published_at: report.published_at, pages: report.pages } };
}


// 이미 저장된 연차보고서 이벤트의 시점을 다시 확인한다.
//
// 연차보고서에서 뽑은 사실은 기간 집계와 시점 사건이 섞여 있는데, 처음 적재할 때는 둘 다
// 보고 기간 말일로 들어갔다. 그래서 "2세대 블레이드 배터리 출시"처럼 그 해 3월에 있었던 일이
// 12월 31일에 일어난 것처럼 보인다. 기간 집계는 말일이 맞으므로 건드리지 않고,
// 시점 사건만 웹 검색으로 실제 시기를 찾아 고친다. 찾지 못하면 날짜를 바꾸지 않고
// 연 단위로만 믿는다고 표시한다. 모르는 것을 아는 척 옮기지 않기 위함이다.
const REDATE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array", maxItems: 20,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "kind", "occurred_at", "occurred_precision", "basis_ko"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["period_aggregate", "point_event"] },
          occurred_at: { type: "string" },
          occurred_precision: { type: "string", enum: ["day", "month", "half", "year"] },
          basis_ko: { type: "string" }
        }
      }
    }
  }
};

const REDATE_INSTRUCTIONS = [
  "중국 배터리 산업 애널리스트다. 이미 정리된 기업 이벤트 목록의 시점을 다시 판정한다.",
  "각 항목을 두 종류로 나눈다. period_aggregate는 한 기간을 합산하거나 기간 말 기준으로 잰 값이다(연간 매출, 연간 판매량, 기간 말 생산능력). point_event는 특정 시점에 일어난 일이다(투산·가동 개시, 착공, 신제품 출시, 고객 인증, 계약 체결, 양산 개시).",
  "period_aggregate는 occurred_at을 지금 값 그대로 두고 occurred_precision을 year로 한다. 기간 집계는 특정 하루의 일이 아니기 때문이다.",
  "point_event는 웹 검색으로 그 일이 실제로 언제 있었는지 찾는다. 회사명과 사건 내용을 함께 검색한다.",
  "날짜까지 확인되면 그 날짜와 day, 월까지만 확인되면 그 달 1일과 month, 분기·반기까지만 확인되면 그 기간 말일과 half를 쓴다.",
  "확인하지 못하면 occurred_at을 지금 값 그대로 두고 occurred_precision을 year로 한다. 추측으로 날짜를 옮기지 않는다.",
  "새로 정한 날짜는 보고 연도 1월 1일부터 이듬해 4월 말 사이여야 한다. 연차보고서는 보고 기간이 끝난 뒤 발행되므로 이듬해 초의 보고기간 후 사건이 실릴 수 있다.",
  "basis_ko에는 그렇게 판정한 근거를 한 문장으로 쓴다. 검색으로 확인했다면 무엇을 근거로 했는지 적는다.",
  "id는 입력에 주어진 값을 그대로 돌려준다. 바꾸거나 새로 만들지 않는다.",
].join(" ");

export async function redateReportEvents({ company, events, provider = "openai" }) {
  const targets = events.filter((event) => event.title_ko && event.fact_ko).slice(0, 20);
  if (!targets.length) return { items: [], checked: 0 };
  const lines = targets.map((event) =>
    `id=${event.id} | 현재시점=${event.occurred_at} | ${event.title_ko} | ${String(event.fact_ko).replace(/\s+/g, " ").slice(0, 220)}`
  );
  const years = [...new Set(targets.map((event) => String(event.occurred_at).slice(0, 4)))].join(", ");
  const result = await createJsonResponse({
    name: "event_redate",
    schema: REDATE_SCHEMA,
    instructions: REDATE_INSTRUCTIONS,
    webSearch: true,
    provider,
    input: `회사: ${company.name_ko} [${company.name_zh}]\n보고 연도: ${years}\n\n판정할 이벤트:\n${lines.join("\n")}`,
  });
  const byId = new Map(targets.map((event) => [String(event.id), event]));
  const items = [];
  for (const item of result.data.items || []) {
    const original = byId.get(String(item.id));
    if (!original) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(item.occurred_at) ? item.occurred_at : original.occurred_at;
    // 보고 연도를 벗어난 날짜는 모델이 잘못 짚은 것으로 보고 원래 값을 지킨다.
    // 연차보고서는 보고 기간이 끝난 뒤 발행되므로 "보고기간 후 사건"(예: 12월 결산 보고서에 적힌
    // 이듬해 3월 발표)이 실릴 수 있다. 보고 연도 1월 1일부터 이듬해 4월 말까지를 허용하고
    // 그 밖의 날짜는 모델이 잘못 짚은 것으로 보고 원래 값을 지킨다.
    const fiscalYear = Number(String(original.occurred_at).slice(0, 4));
    const sameYear = date >= `${fiscalYear}-01-01` && date <= `${fiscalYear + 1}-04-30`;
    const occurredAt = sameYear ? date : original.occurred_at;
    items.push({
      id: original.id,
      occurred_at: occurredAt,
      occurred_precision: item.kind === "period_aggregate" ? "year" : (sameYear ? item.occurred_precision : "year"),
      occurred_basis: String(item.basis_ko || "").slice(0, 300) || null,
      changed: occurredAt !== original.occurred_at,
    });
  }
  return { items, checked: targets.length, provider: result.provider };
}
