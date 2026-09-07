import { supabaseRest } from "./supabase.js";
import { createJsonResponse, llmConfig } from "./llm-provider.js";
import { COMPANIES } from "./china-sources.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "./timeline-layers.js";

// 이벤트 문장에서 개념어 사이의 관계(주어-관계-목적어)를 뽑는다. event_fact(전략 장부)가
// "회사 ↔ 상대방" 비즈니스 관계를 다룬다면, 이건 그 안의 소재·공정·스펙·제품 개념끼리의
// 관계를 다룬다. 목적은 비교 리포트가 "두 회사가 같은 개념을 다루는지", "어느 쪽이 먼저
// 그 개념을 언급했는지"를 텍스트 나열이 아니라 집합 연산으로 짚게 하는 것이다.
//
// 신뢰성은 event_fact와 같은 원칙: 모델이 아니라 저장 전 검사로 지킨다.
//   1) excerpt가 이벤트 원문에 글자 그대로 있어야 한다.
//   2) subject_original·object_original이 그 excerpt 안에 글자 그대로 있어야 한다.
//   3) predicate·kind는 닫힌 목록이다.

export const CONCEPT_KINDS = ["material", "process", "spec", "product", "application", "standard"];
export const PREDICATES = ["uses", "improves", "degrades", "replaces", "requires", "enables", "achieves", "certified_by", "competes_with", "part_of", "derived_from", "other"];

const EVENTS_PER_CALL = 6;
const MAX_CALLS_PER_HOP = 4;
// LLM 호출 하나가 20~40초 걸린다. 예산이 남았는지만 보고 배치를 시작하면 41초에 시작한 호출이
// 40초를 더 써서 훅이 60초 함수 한도를 넘고, 다음 훅 호출이 나가지 못해 체인이 끊긴다.
// 2026-09-08에 훅 4가 82초를 써서 거기서 멈췄다. 호출 하나 분량을 남겨 두고 멈춘다.
const CALL_BUDGET_MS = 40000;
const MAX_EDGES_PER_EVENT = 6;

const EVENT_SELECT = "id,company_id,occurred_at,title_ko,fact_ko,original_excerpt_ko,layer_key,company(name_ko)";

function edgeSchema() {
  const str = { type: "string" };
  return {
    type: "object", additionalProperties: false, required: ["edges"],
    properties: {
      edges: {
        type: "array", maxItems: EVENTS_PER_CALL * MAX_EDGES_PER_EVENT,
        items: {
          type: "object", additionalProperties: false,
          required: ["event_index", "subject_original", "subject_kind", "predicate", "object_original", "object_kind", "value_text", "excerpt"],
          properties: {
            event_index: { type: "integer" },
            subject_original: str,
            subject_kind: { type: "string", enum: CONCEPT_KINDS },
            predicate: { type: "string", enum: PREDICATES },
            object_original: str,
            object_kind: { type: "string", enum: CONCEPT_KINDS },
            value_text: str,
            excerpt: str,
          }
        }
      }
    }
  };
}

export const INSTRUCTIONS = `당신은 중국 배터리 산업 이벤트 문장에서 개념어 사이의 관계를 뽑는 분석가다. 문장에 실제로 적힌 개념과 관계만 옮기고, 배경지식으로 추론하거나 채워 넣지 않는다.

개념 종류(kind):
- material: 소재·화학 조성 (실리콘 음극재, LFP, 하이니켈 삼원계, 황화물 전해질…)
- process: 공정·제조법 (건식전극, 도핑, 코팅, 소결…)
- spec: 성능·품질 지표 (에너지밀도, 사이클 수명, 안전성, 초기효율…) — 수치 자체가 아니라 지표 이름
- product: 제품·모델 (반고체 배터리, 46파이 원통형, 4680셀…)
- application: 용도·탑재처 (ESS, 상용차, 저속전기차, 로봇…)
- standard: 인증·표준·특허 (UN38.3, 열폭주 미확산 인증, 특허…)

관계(predicate): uses(사용) / improves(개선) / degrades(저하) / replaces(대체) / requires(필요) / enables(가능하게 함) / achieves(달성) / certified_by(인증) / competes_with(경쟁) / part_of(하위개념) / derived_from(파생) / other.

규칙:
1. subject_original·object_original은 문장에 쓰인 표기를 그대로 옮긴다(줄이거나 풀어 쓰지 않는다).
2. excerpt는 그 관계가 적힌 구절을 원문에서 글자 그대로 복사한다. 한 문장 이내로 짧게. subject_original과 object_original은 반드시 이 excerpt 안에 그대로 있어야 한다.
3. value_text는 그 관계에 딸린 수치·표기가 있으면 excerpt 안의 표기를 그대로 복사한다(예: "355mAh/g", "12% 개선"). 없으면 빈 문자열.
4. 회사명·상대방명(고객사·합작사 등)은 subject·object로 쓰지 않는다. 개념어끼리의 관계만 뽑는다.
5. 한 문장에 개념이 여러 개면 관계마다 따로 만든다. 억지로 관계를 만들지 말고, 명확한 관계가 없으면 만들지 않는다.
6. 시장 통계·업계 전망·경쟁사 일반론은 뽑지 않는다. 이 이벤트가 말하는 이 회사(또는 명시된 계열사)의 사실에서만 뽑는다.`;

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

// alias 사전을 조회해 표기를 정규 개념명으로 통일한다. 사전에 없으면 원문 표기를 그대로 쓴다.
async function resolveAliases(terms) {
  if (!terms.length) return new Map();
  const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const list = unique.map((term) => `"${term.replace(/"/g, '\\"')}"`).join(",");
  const rows = await supabaseRest(`concept_alias?select=alias,canonical&alias=in.(${list})`).catch(() => []);
  return new Map(rows.map((row) => [row.alias, row.canonical]));
}

// 모델 출력 하나를 검사해 저장할 행으로 만들거나 이유와 함께 버린다. aliasMap은 원문 표기 기준.
export function validateEdge(raw, event, aliasMap) {
  const text = normalize(`${event.title_ko} ${event.fact_ko} ${event.original_excerpt_ko || ""}`);
  const excerpt = String(raw.excerpt || "").trim();
  if (excerpt.length < 4 || !text.includes(normalize(excerpt))) return { drop: "excerpt_not_in_source" };
  const subjectOriginal = String(raw.subject_original || "").trim();
  const objectOriginal = String(raw.object_original || "").trim();
  if (!subjectOriginal || !objectOriginal) return { drop: "empty_term" };
  const excerptNorm = normalize(excerpt);
  if (!excerptNorm.includes(normalize(subjectOriginal))) return { drop: "subject_not_in_excerpt" };
  if (!excerptNorm.includes(normalize(objectOriginal))) return { drop: "object_not_in_excerpt" };
  if (normalize(subjectOriginal) === normalize(objectOriginal)) return { drop: "self_loop" };
  const valueText = String(raw.value_text || "").trim();
  if (valueText && !excerptNorm.includes(normalize(valueText))) return { drop: "value_not_in_excerpt" };
  return {
    row: {
      event_id: event.id,
      company_id: event.company_id,
      occurred_at: event.occurred_at,
      layer_key: normalizeLayerKey(event.layer_key),
      subject: aliasMap.get(subjectOriginal) || subjectOriginal,
      subject_original: subjectOriginal,
      subject_kind: CONCEPT_KINDS.includes(raw.subject_kind) ? raw.subject_kind : null,
      predicate: PREDICATES.includes(raw.predicate) ? raw.predicate : "other",
      object: aliasMap.get(objectOriginal) || objectOriginal,
      object_original: objectOriginal,
      object_kind: CONCEPT_KINDS.includes(raw.object_kind) ? raw.object_kind : null,
      value_text: valueText || null,
      excerpt,
    }
  };
}

export async function extractConceptsForEvents(events, { provider = "auto" } = {}) {
  const byId = new Map(COMPANIES.map((company) => [company.id, company]));
  const input = events.map((event, index) => {
    const company = byId.get(event.company_id);
    return `[${index}] 회사: ${event.company?.name_ko || company?.name_ko || event.company_id} · 시점: ${event.occurred_at}\n제목: ${event.title_ko}\n사실: ${event.fact_ko}${event.original_excerpt_ko ? `\n원문 발췌: ${event.original_excerpt_ko}` : ""}`;
  }).join("\n\n");
  const result = await createJsonResponse({ name: "concept_edge_extraction", schema: edgeSchema(), timeoutMs: CALL_BUDGET_MS, instructions: INSTRUCTIONS, input, provider });
  const raws = result.data.edges || [];
  const aliasMap = await resolveAliases(raws.flatMap((raw) => [raw.subject_original, raw.object_original]));
  const rows = [];
  const dropped = {};
  for (const raw of raws) {
    const event = events[raw.event_index];
    if (!event) { dropped.bad_index = (dropped.bad_index || 0) + 1; continue; }
    const checked = validateEdge(raw, event, aliasMap);
    if (checked.drop) { dropped[checked.drop] = (dropped[checked.drop] || 0) + 1; continue; }
    rows.push({ ...checked.row, extractor: `${result.provider}:${result.model}` });
  }
  return { rows, dropped, model: result.model };
}

// 아직 추출하지 않은 이벤트를 몇 묶음 처리한다. 예산이 다하면 멈추고 남은 수를 돌려준다.
// extractMissingFacts와 같은 모양이라 curate 훅에 나란히 끼워 넣을 수 있다.
export async function extractMissingConcepts({ deadline = Infinity, provider = "auto" } = {}) {
  if (!llmConfig(provider)) return { extracted: 0, events: 0, remaining: 0, skipped: "llm_not_configured" };
  const pending = await supabaseRest(`event?select=${EVENT_SELECT}&concepts_extracted_at=is.null&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=${EVENTS_PER_CALL * MAX_CALLS_PER_HOP + 1}`);
  let extracted = 0, done = 0;
  const dropped = {};
  for (let i = 0; i < Math.min(pending.length, EVENTS_PER_CALL * MAX_CALLS_PER_HOP); i += EVENTS_PER_CALL) {
    if (Date.now() > deadline - CALL_BUDGET_MS) break;
    const batch = pending.slice(i, i + EVENTS_PER_CALL);
    const { rows, dropped: batchDropped } = await extractConceptsForEvents(batch, { provider });
    for (const [key, n] of Object.entries(batchDropped)) dropped[key] = (dropped[key] || 0) + n;
    if (rows.length) await supabaseRest("concept_edge", { method: "POST", prefer: "return=minimal", body: rows });
    const stamp = new Date().toISOString();
    await supabaseRest(`event?id=in.(${batch.map((event) => event.id).join(",")})`, { method: "PATCH", prefer: "return=minimal", body: { concepts_extracted_at: stamp } });
    extracted += rows.length;
    done += batch.length;
  }
  return { extracted, events: done, dropped, remaining: Math.max(pending.length - done, 0) };
}

// ── 비교 리포트용 요약 ────────────────────────────────────────────────
// 두 회사의 개념 그래프를 맞대어 "겹치는 개념", "한쪽에만 있는 개념", "누가 먼저 다뤘는지"를
// 집합 연산으로 뽑는다. compare-report.js가 이걸 이벤트 텍스트 나열에 덧붙여 프롬프트에 준다.
export async function summarizeConceptGraph({ companyIdA, companyIdB, limit = 400 }) {
  const rows = await supabaseRest(
    `concept_edge?select=company_id,occurred_at,subject,subject_kind,predicate,object,object_kind,value_text`
    + `&company_id=in.(${companyIdA},${companyIdB})&order=occurred_at.asc&limit=${limit}`
  );
  const byCompany = { [companyIdA]: [], [companyIdB]: [] };
  for (const row of rows) byCompany[row.company_id]?.push(row);

  // 개념 하나가 처음 등장한 시점(그 회사 기준). 같은 개념을 여러 번 다뤄도 첫 등장만 본다.
  function firstSeen(list) {
    const seen = new Map();
    for (const row of list) {
      for (const term of [row.subject, row.object]) {
        if (!seen.has(term)) seen.set(term, row.occurred_at);
      }
    }
    return seen;
  }
  const seenA = firstSeen(byCompany[companyIdA]);
  const seenB = firstSeen(byCompany[companyIdB]);

  const shared = [];
  for (const [term, dateA] of seenA) {
    if (!seenB.has(term)) continue;
    const dateB = seenB.get(term);
    shared.push({ term, first_seen_a: dateA, first_seen_b: dateB, leader: dateA < dateB ? "A" : dateA > dateB ? "B" : "tie" });
  }
  const onlyA = [...seenA.keys()].filter((term) => !seenB.has(term));
  const onlyB = [...seenB.keys()].filter((term) => !seenA.has(term));

  return {
    edges_a: byCompany[companyIdA].length,
    edges_b: byCompany[companyIdB].length,
    shared_concepts: shared,
    only_a: onlyA,
    only_b: onlyB,
  };
}

// 관리자 화면(파이프라인 보기)이 실제 프롬프트를 그대로 읽는다.
export const CONCEPT_EDGE_PROMPT = INSTRUCTIONS;
