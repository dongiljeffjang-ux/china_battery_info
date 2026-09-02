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
          required: ["occurred_at", "title_ko", "fact_ko", "trajectory_track", "layer_key", "region_scope", "source_url", "source_name", "original_excerpt", "original_excerpt_ko"],
          properties: {
            occurred_at: { type: "string" },
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
      entity_names: matchGroupEntities(company.id, `${title} ${fact} ${event.original_excerpt}`),
    });
  }
  return { rows, dropped, returned: (result.data.events || []).length, provider: result.provider };
}
