import { supabaseRest } from "./supabase.js";
import { createJsonResponse, llmConfig } from "./llm-provider.js";
import { COMPANIES } from "./china-sources.js";

// 이벤트 문장에서 구조화 사실을 뽑는다 (전략 장부의 재료).
//
// 신뢰성은 모델이 아니라 여기의 검사로 지킨다.
//   1) 근거 발췌가 이벤트 원문에 글자 그대로 있어야 한다. 없으면 버린다.
//   2) 수량 표기가 발췌 안에 글자 그대로 있어야 한다. 숫자는 모델이 아니라 이 코드가 표기에서 읽는다.
//   3) 단위·상태·세그먼트는 닫힌 목록이다. 모델이 자유 서술할 여지를 주지 않는다.
// 그래서 모델이 숫자를 지어내거나 환산해도 화면에 올라가지 못한다.

export const FACT_TYPES = ["capacity", "shipment", "financial", "customer", "partnership", "site", "spec"];
export const SEGMENTS = ["ncm", "lfp", "precursor", "anode", "cell", "ess", "other"];
export const UNITS = ["t/yr", "GWh/yr", "GWh", "t", "CNY_100M", "CNY_10K", "pct", "Wh/kg", "mAh/g", "C", "units", "none"];
export const STATUSES = ["planned", "under_construction", "operating", "completed", "suspended", "unknown"];
export const COUNTERPARTY_KINDS = ["oem", "cell", "material", "resource", "government", "other"];

const EVENTS_PER_CALL = 6;
const MAX_CALLS_PER_HOP = 4;
const MAX_FACTS_PER_EVENT = 8;

const EVENT_SELECT = "id,company_id,occurred_at,title_ko,fact_ko,original_excerpt_ko,evidence_kind,company(name_ko)";

function factSchema() {
  const str = { type: "string" };
  return {
    type: "object", additionalProperties: false, required: ["facts"],
    properties: {
      facts: {
        type: "array", maxItems: EVENTS_PER_CALL * MAX_FACTS_PER_EVENT,
        items: {
          type: "object", additionalProperties: false,
          required: ["event_index", "fact_type", "segment", "item", "metric", "quantity_text", "unit", "status", "country", "city", "counterparty", "counterparty_original", "counterparty_kind", "relation", "period", "excerpt"],
          properties: {
            event_index: { type: "integer" },
            fact_type: { type: "string", enum: FACT_TYPES },
            segment: { type: "string", enum: SEGMENTS },
            item: str, metric: str, quantity_text: str,
            unit: { type: "string", enum: UNITS },
            status: { type: "string", enum: STATUSES },
            country: str, city: str, counterparty: str, counterparty_original: str,
            counterparty_kind: { type: "string", enum: COUNTERPARTY_KINDS },
            relation: str, period: str, excerpt: str,
          }
        }
      }
    }
  };
}

const INSTRUCTIONS = `당신은 중국 배터리 산업 이벤트 문장에서 구조화 사실을 뽑는 분석가다. 문장에 적힌 것만 옮기고, 계산·환산·추정을 하지 않는다.

사실 종류(fact_type):
- capacity: 생산능력·증설·공장(연 X만 톤, X GWh). 수량이 없어도 공장·라인 사실이면 만든다.
- shipment: 출하량·판매량·장착량 (수량 필수)
- financial: 매출·순이익·영업이익·현금흐름 (수량 필수, metric에 revenue/net_profit/operating_profit/cash_flow 등)
- customer: 고객 지정(定点)·수주·공급계약·탑재 (counterparty 필수)
- partnership: 합작·제휴·구매약정·투자 (counterparty 필수)
- site: 거점·법인·공장 위치 (country 필수, 수량 없어도 됨)
- spec: 기술 스펙 (수량 필수, metric에 energy_density/capacity_per_gram/c_rate/cycle_life 등)

세그먼트(segment): ncm 삼원·하이니켈 양극재 / lfp LFP·LMFP 양극재 / precursor 전구체·니켈·코발트 원료 / anode 음극·흑연·실리콘 / cell 셀·팩·동력전지 / ess ESS·저장 / other 그 밖(회사 전체 실적 등).

규칙:
1. excerpt는 이벤트 문장에서 그 사실이 적힌 구절을 글자 그대로 복사한다. 요약·재작성 금지. 한 문장 이내로 짧게.
2. quantity_text는 excerpt 안의 수량 표기를 글자 그대로 복사한다 (예: "4만 톤", "30GWh", "134.48억 위안", "355mAh/g"). 수량이 없으면 빈 문자열.
3. unit은 quantity_text에 맞는 표준 단위. 연 생산능력은 t/yr 또는 GWh/yr, 누적·출하는 t 또는 GWh, 금액은 CNY_100M(억 위안)·CNY_10K(만 위안), 비율은 pct. 수량이 없으면 none.
4. 숫자 하나마다 사실 하나. "4만 톤 삼원재·4만 톤 전구체"는 두 개의 capacity 사실이다.
5. status: 계획·추진·예정=planned, 건설·착공·골조=under_construction, 투산·가동·양산·공급개시=operating, 완료·달성=completed, 중단·지연=suspended, 판단 불가=unknown.
6. country는 한국어 국가명(중국, 헝가리, 프랑스, 모로코, 튀르키예, 한국, 미국, 인도네시아…). 중국 내 도시면 country=중국, city=도시명. 문장에 지역이 없으면 빈 문자열.
7. counterparty는 상대방의 통용 표기(BMW, 폭스바겐, POSCO, Orano, CATL, 스텔란티스…), counterparty_original은 문장 속 표기. counterparty_kind: oem 완성차 / cell 셀사 / material 소재사 / resource 자원·광산·정제 / government 정부·지자체 / other.
8. relation은 관계를 한두 단어로 (지정, 공급, 합작, 구매약정, 탑재, 인증, 투자).
9. period는 수치가 가리키는 기간 (2024, 2025H1, 2025Q3). 모르면 빈 문자열.
10. 회사 소개·시장 통계·업계 전망은 사실로 만들지 않는다. 이 회사(또는 명시된 계열사)의 사실만.`;

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

// "4만 톤" → 40000, "134.48억 위안" → 134.48 (억 단위 유지), "30GWh" → 30.
function parseQuantity(text, unit) {
  const match = String(text || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(만|억|천)?/);
  if (!match) return null;
  let value = Number(match[1]);
  const scale = match[2];
  if (unit === "CNY_100M") {
    if (scale === "만") value = value / 10000;
    return value;
  }
  if (unit === "CNY_10K") {
    if (scale === "억") value = value * 10000;
    return value;
  }
  if (scale === "만") value *= 10000;
  else if (scale === "억") value *= 100000000;
  else if (scale === "천") value *= 1000;
  return Number.isFinite(value) ? value : null;
}

function sourceTierOf(evidenceKind) {
  if (evidenceKind === "annual_report" || evidenceKind === "periodic_report") return "disclosure";
  if (evidenceKind === "web_backfill") return "web";
  return "article";
}

const COUNTRY_ALIASES = { "중국": "중국", "china": "중국", "中国": "중국", "대한민국": "한국", "korea": "한국", "터키": "튀르키예", "turkey": "튀르키예", "usa": "미국", "america": "미국", "uk": "영국" };
function normalizeCountry(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return COUNTRY_ALIASES[raw.toLowerCase()] || raw;
}

// 모델 출력 하나를 검사해 저장할 행으로 만들거나 이유와 함께 버린다.
export function validateFact(raw, event) {
  const text = normalize(`${event.title_ko} ${event.fact_ko} ${event.original_excerpt_ko || ""}`);
  const excerpt = String(raw.excerpt || "").trim();
  if (excerpt.length < 6 || !text.includes(normalize(excerpt))) return { drop: "excerpt_not_in_source" };
  const quantityText = String(raw.quantity_text || "").trim();
  let quantity = null;
  if (quantityText) {
    if (!normalize(excerpt).includes(normalize(quantityText))) return { drop: "quantity_not_in_excerpt" };
    quantity = parseQuantity(quantityText, raw.unit);
    if (quantity === null) return { drop: "quantity_unparsable" };
  }
  const needsQuantity = ["shipment", "financial", "spec"].includes(raw.fact_type);
  if (needsQuantity && quantity === null) return { drop: "quantity_required" };
  const counterparty = String(raw.counterparty || "").trim() || null;
  if (["customer", "partnership"].includes(raw.fact_type) && !counterparty) return { drop: "counterparty_required" };
  const country = normalizeCountry(raw.country);
  if (raw.fact_type === "site" && !country) return { drop: "country_required" };
  return {
    row: {
      event_id: event.id,
      company_id: event.company_id,
      fact_type: raw.fact_type,
      segment: SEGMENTS.includes(raw.segment) ? raw.segment : "other",
      item: String(raw.item || "").trim() || null,
      metric: String(raw.metric || "").trim() || null,
      quantity,
      unit: quantity === null ? null : raw.unit,
      quantity_text: quantityText || null,
      status: STATUSES.includes(raw.status) ? raw.status : "unknown",
      country,
      city: String(raw.city || "").trim() || null,
      counterparty,
      counterparty_original: String(raw.counterparty_original || "").trim() || null,
      counterparty_kind: counterparty ? (COUNTERPARTY_KINDS.includes(raw.counterparty_kind) ? raw.counterparty_kind : "other") : null,
      relation: String(raw.relation || "").trim() || null,
      period: String(raw.period || "").trim() || null,
      occurred_at: event.occurred_at,
      excerpt,
      source_tier: sourceTierOf(event.evidence_kind),
    }
  };
}

export async function extractFactsForEvents(events, { provider = "auto" } = {}) {
  const byId = new Map(COMPANIES.map((company) => [company.id, company]));
  const input = events.map((event, index) => {
    const company = byId.get(event.company_id);
    return `[${index}] 회사: ${event.company?.name_ko || company?.name_ko || event.company_id} · 시점: ${event.occurred_at}\n제목: ${event.title_ko}\n사실: ${event.fact_ko}${event.original_excerpt_ko ? `\n원문 발췌: ${event.original_excerpt_ko}` : ""}`;
  }).join("\n\n");
  const result = await createJsonResponse({ name: "event_fact_extraction", schema: factSchema(), instructions: INSTRUCTIONS, input, provider });
  const rows = [];
  const dropped = {};
  for (const raw of result.data.facts || []) {
    const event = events[raw.event_index];
    if (!event) { dropped.bad_index = (dropped.bad_index || 0) + 1; continue; }
    const checked = validateFact(raw, event);
    if (checked.drop) { dropped[checked.drop] = (dropped[checked.drop] || 0) + 1; continue; }
    rows.push({ ...checked.row, extractor: `${result.provider}:${result.model}` });
  }
  return { rows, dropped, model: result.model };
}

// 아직 추출하지 않은 이벤트를 몇 묶음 처리한다. 예산이 다하면 멈추고 남은 수를 돌려준다.
export async function extractMissingFacts({ deadline = Infinity, provider = "auto" } = {}) {
  if (!llmConfig(provider)) return { extracted: 0, events: 0, remaining: 0, skipped: "llm_not_configured" };
  const pending = await supabaseRest(`event?select=${EVENT_SELECT}&facts_extracted_at=is.null&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=${EVENTS_PER_CALL * MAX_CALLS_PER_HOP + 1}`);
  let extracted = 0, done = 0;
  const dropped = {};
  for (let i = 0; i < Math.min(pending.length, EVENTS_PER_CALL * MAX_CALLS_PER_HOP); i += EVENTS_PER_CALL) {
    if (Date.now() > deadline) break;
    const batch = pending.slice(i, i + EVENTS_PER_CALL);
    const { rows, dropped: batchDropped } = await extractFactsForEvents(batch, { provider });
    for (const [key, n] of Object.entries(batchDropped)) dropped[key] = (dropped[key] || 0) + n;
    if (rows.length) await supabaseRest("event_fact", { method: "POST", prefer: "return=minimal", body: rows });
    const stamp = new Date().toISOString();
    await supabaseRest(`event?id=in.(${batch.map((event) => event.id).join(",")})`, { method: "PATCH", prefer: "return=minimal", body: { facts_extracted_at: stamp } });
    extracted += rows.length;
    done += batch.length;
  }
  return { extracted, events: done, dropped, remaining: Math.max(pending.length - done, 0) };
}
