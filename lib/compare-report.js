import { createJsonResponse } from "./llm-provider.js";
import { stripCitations } from "./event-backfill.js";
import { supabaseRest } from "../api/lib/supabase.js";
import { embedEvents } from "./vector-ingestion.js";
import { matchGroupEntities } from "./company-groups.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "./timeline-layers.js";

// 비교 화면에 표시된 두 회사의 이벤트를 근거로 A4 한 장 분량의 비교 리포트를 만든다.
//
// 두 단계로 나눈다.
//   1) 작성: 화면에 있는 사실만 근거로 초안을 만든다. 웹 검색을 쓰지 않는다.
//   2) 검증: 그 초안을 웹 검색 한 번으로 대조해 틀린 대목을 고치고 근거를 덧붙인다.
// 나누는 이유는, 검색을 처음부터 열어 두면 화면에 없는 사실로 글을 쓰고
// 그것이 우리 데이터인지 검색 결과인지 구분되지 않기 때문이다.
//
// 검증 결과는 리포트에만 머물지 않는다. 우리 이벤트의 날짜가 틀렸다고 확인되면 그 이벤트의
// 시점을 고치고, 검색으로 새로 확인된 사실은 참고 등급(web_backfill) 이벤트로 넣는다.
// 그래야 다음 리포트가 같은 오류를 다시 고치느라 검색을 쓰지 않는다.

const SEGMENTS = ["셀", "양극재", "음극재", "공급망", "전반"];
const PRECISIONS = ["day", "month", "half", "year"];

const REPORT_SHAPE = {
  type: "object",
  additionalProperties: false,
  required: ["headline_ko", "market", "technology", "timeline", "korea_insight"],
  properties: {
    headline_ko: { type: "string" },
    // 시장 축(실적·생산능력·고객·수주·해외)에서 두 회사를 나란히 비교한다.
    market: {
      type: "object", additionalProperties: false,
      required: ["a_ko", "b_ko", "contrast_ko"],
      properties: { a_ko: { type: "string" }, b_ko: { type: "string" }, contrast_ko: { type: "string" } }
    },
    // 기술 축(소재·화학·공정·특허·개발)에서 두 회사를 나란히 비교한다.
    technology: {
      type: "object", additionalProperties: false,
      required: ["a_ko", "b_ko", "contrast_ko"],
      properties: { a_ko: { type: "string" }, b_ko: { type: "string" }, contrast_ko: { type: "string" } }
    },
    timeline: {
      type: "object", additionalProperties: false,
      required: ["a_ko", "b_ko", "divergence_ko"],
      properties: { a_ko: { type: "string" }, b_ko: { type: "string" }, divergence_ko: { type: "string" } }
    },
    korea_insight: {
      type: "object", additionalProperties: false,
      required: ["points"],
      properties: {
        points: {
          type: "array", minItems: 2, maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            required: ["segment", "implication_ko", "point_ko", "basis_ko"],
            properties: {
              segment: { type: "string", enum: SEGMENTS },
              // 한 줄 결론: 이 차이가 한국의 어느 쪽에 유리하거나 압박이 될 수 있는지.
              implication_ko: { type: "string" },
              point_ko: { type: "string" },
              basis_ko: { type: "string" }
            }
          }
        }
      }
    }
  }
};

const VERIFIED_SHAPE = {
  type: "object",
  additionalProperties: false,
  required: [...REPORT_SHAPE.required, "verification"],
  properties: {
    ...REPORT_SHAPE.properties,
    verification: {
      type: "object", additionalProperties: false,
      required: ["checked_ko", "corrections", "added_evidence"],
      properties: {
        checked_ko: { type: "string" },
        corrections: {
          type: "array", maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            required: ["event_id", "field", "original_ko", "corrected_ko", "reason_ko", "source_url", "occurred_at", "occurred_precision"],
            properties: {
              // 우리 이벤트의 오류라면 그 이벤트의 id. 리포트 문장만의 오류면 빈 문자열.
              event_id: { type: "string" },
              field: { type: "string", enum: ["occurred_at", "number", "subject", "other"] },
              original_ko: { type: "string" },
              corrected_ko: { type: "string" },
              reason_ko: { type: "string" },
              source_url: { type: "string" },
              // field가 occurred_at일 때만 채운다. 그 밖에는 빈 문자열.
              occurred_at: { type: "string" },
              occurred_precision: { type: "string", enum: [...PRECISIONS, ""] }
            }
          }
        },
        added_evidence: {
          type: "array", maxItems: 4,
          items: {
            type: "object", additionalProperties: false,
            required: ["company", "occurred_at", "occurred_precision", "title_ko", "fact_ko", "trajectory_track", "layer_key", "source_name", "source_url"],
            properties: {
              company: { type: "string", enum: ["A", "B"] },
              occurred_at: { type: "string" },
              occurred_precision: { type: "string", enum: PRECISIONS },
              title_ko: { type: "string" },
              fact_ko: { type: "string" },
              trajectory_track: { type: "string", enum: ["market", "technology"] },
              layer_key: { type: "string", enum: LAYER_ENUM },
              source_name: { type: "string" },
              source_url: { type: "string" }
            }
          }
        }
      }
    }
  }
};

const LENGTH_GUIDE =
  "A4 한 장에 담아야 하므로 분량을 지킨다. headline_ko는 두 회사의 차이를 한 문장으로 요약한다. " +
  "market과 technology의 a_ko와 b_ko는 각각 두세 문장, contrast_ko는 두 문장으로 쓴다. " +
  "timeline의 a_ko와 b_ko는 각각 두세 문장으로 시점에 따른 움직임의 순서와 속도를 쓰고, divergence_ko는 두 회사가 갈라진 대목을 두 문장으로 쓴다. " +
  "korea_insight의 implication_ko는 한 문장, point_ko는 두세 문장, basis_ko는 한 문장 안으로 쓴다. 개조식으로 끊지 말고 줄글로 쓴다.";

const AXIS_RULE =
  "market(시장 축)에는 실적·매출·이익, 생산능력·출하·가동률, 고객·수주·공급계약, 증설·투자, 해외 진출처럼 사업·시장에 관한 사실만 쓴다. " +
  "technology(기술 축)에는 소재·화학 조성, 공정·성능, 특허·표준·인증, 신제품 개발·양산 단계처럼 기술에 관한 사실만 쓴다. " +
  "각 이벤트에는 [track=market] 또는 [track=technology] 표시가 붙어 있으니 그 축에 해당하는 절에만 쓰고 두 축을 섞지 않는다. " +
  "한 축에 해당 이벤트가 없으면 그 절의 a_ko 또는 b_ko에 '해당 축에서 확인된 사실이 없습니다.'라고 쓴다.";

const FACT_RULE =
  "제공된 이벤트에 적힌 사실만 근거로 쓴다. 화면에 없는 수치와 사건을 지어내지 않는다. " +
  "회사명은 제공된 한국어 표준명을 그대로 쓴다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다. " +
  "market·technology·timeline은 사실 정리이므로 해석을 섞지 않는다. korea_insight만 해석이다. " +
  "본문 어디에도 URL·마크다운 링크·괄호 안 출처 표기를 넣지 않는다. 출처는 verification.added_evidence에만 쓴다. " +
  "한국어 문장 안에 한자나 다른 문자 체계의 글자를 섞지 않는다. " +
  "market·technology·timeline의 a_ko·b_ko는 회사명으로 문장을 시작하지 않는다. 화면이 회사명을 제목으로 따로 붙이므로 '2025년 …' 처럼 사실로 바로 시작한다. " +
  "숫자는 '661GWh', '3,448억 위안', '+33.9%'처럼 단위와 함께 짧게 쓴다.";

const INSIGHT_RULE =
  "korea_insight는 한국 배터리 셀사·양극재·음극재 소재사의 임원이자 시장 애널리스트의 눈으로 쓴다. " +
  "implication_ko에는 두 회사의 이 차이가 한국의 어느 쪽(예: 삼원계 양극재사, LFP 양극재사, 인조흑연 음극재사, 셀사)에 상대적으로 유리해질 수 있는지 또는 압박이 될 수 있는지를 한 문장으로 먼저 결론 짓는다. " +
  "point_ko에는 왜 그런지를 경쟁 구도·수요 구조·원가와 기술 흐름·공급망 위치 가운데 해당하는 축으로 설명한다. " +
  "사실을 되풀이하는 요약을 쓰지 않고, '확인해야 한다'·'점검이 필요하다'·'대응해야 한다' 같은 행동 지시나 할 일 목록을 쓰지 않는다. " +
  "제공된 사실로 설명되는 범위 안에서 한 단계까지만 추론하고, 여러 단계를 건너뛴 결론은 쓰지 않는다. 한국 기업의 내부 사정은 알 수 없으므로 한국 쪽은 세부 회사명이 아니라 사업 부문 단위로 말한다. " +
  "단정하기 어려운 대목은 가능성으로 표현하되, 모든 문장을 '가능성이 있다'로 끝내지 말고 방향(유리·압박·중립)은 분명히 한다.";

const VERIFY_RULE =
  "당신은 독립적인 사실 검증자다. 아래 비교 리포트 초안의 사실관계를 웹 검색으로 한 번 대조한다. " +
  "틀렸거나 최신이 아닌 대목을 고쳐 본문에 반영하고, 무엇을 어떻게 고쳤는지 verification.corrections에 남긴다. " +
  "corrections에는 수치·날짜·주체가 실제로 틀린 대목만 넣고 표현만 다듬은 것은 넣지 않는다. 세 건을 넘기지 않는다. " +
  "고친 대목이 입력의 특정 이벤트(id가 붙은 줄)에서 비롯됐으면 event_id에 그 id를 그대로 쓰고, field를 고른다. 날짜 오류면 field를 occurred_at으로 두고 occurred_at(YYYY-MM-DD)과 occurred_precision을 채운다. 그 밖에는 occurred_at과 occurred_precision을 빈 문자열로 둔다. " +
  "초안이 맞으면 본문을 그대로 두고 corrections를 빈 배열로 둔다. 확인하지 못한 대목은 억지로 고치지 않는다. " +
  "added_evidence에는 검색으로 새로 확인한 사실만 넣는다. 입력 이벤트에 이미 있는 사실은 넣지 않는다. company는 그 사실의 주체(A 또는 B), occurred_at은 실제 발생일(YYYY-MM-DD), occurred_precision은 그 날짜를 어디까지 믿는지, trajectory_track은 시장(market)·기술(technology) 가운데 하나다(둘 다여도 더 핵심적인 하나를 고른다). " +
  "layer_key는 그 사실을 8개 표준 레이어 중 하나로 분류한 값이다. " + LAYER_PROMPT_GUIDE + " " +
  "source_url에는 실제로 연 문서의 주소를 그대로 쓴다. 출처를 지어내지 않는다. checked_ko에는 무엇을 확인했는지 한 문장으로 쓴다.";

// ── 정화 ──────────────────────────────────────────────────────────────
// 검증 단계는 웹을 봤다는 표시로 본문에 마크다운 링크를 끼워 넣고, 가끔 다른 문자 체계의
// 글자를 URL 끝에 흘린다. 본문에는 문장만 남기고 출처는 added_evidence로만 다룬다.
function cleanText(value) {
  return stripCitations(value).replace(/\s*\(\s*https?:\/\/[^)]*\)/g, "").trim();
}
function cleanUrl(value) {
  const match = String(value || "").match(/https?:\/\/[\x21-\x7e]+/);
  if (!match) return "";
  try { return new URL(match[0]).href; } catch { return ""; }
}
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

function cleanReport(report) {
  const out = { ...report };
  out.headline_ko = cleanText(report.headline_ko);
  for (const section of ["market", "technology", "timeline"]) {
    out[section] = Object.fromEntries(Object.entries(report[section] || {}).map(([key, value]) => [key, cleanText(value)]));
  }
  out.korea_insight = {
    points: (report.korea_insight?.points || []).map((item) => ({
      segment: item.segment, implication_ko: cleanText(item.implication_ko), point_ko: cleanText(item.point_ko), basis_ko: cleanText(item.basis_ko)
    }))
  };
  if (report.verification) {
    out.verification = {
      checked_ko: cleanText(report.verification.checked_ko),
      corrections: (report.verification.corrections || []).map((item) => ({
        event_id: String(item.event_id || "").trim(),
        field: item.field || "other",
        original_ko: cleanText(item.original_ko), corrected_ko: cleanText(item.corrected_ko), reason_ko: cleanText(item.reason_ko),
        source_url: cleanUrl(item.source_url),
        occurred_at: isDate(item.occurred_at) ? item.occurred_at : "",
        occurred_precision: PRECISIONS.includes(item.occurred_precision) ? item.occurred_precision : ""
      })).filter((item) => item.original_ko && item.corrected_ko && item.original_ko !== item.corrected_ko),
      added_evidence: (report.verification.added_evidence || []).map((item) => ({
        company: item.company === "B" ? "B" : "A",
        occurred_at: isDate(item.occurred_at) ? item.occurred_at : "",
        occurred_precision: PRECISIONS.includes(item.occurred_precision) ? item.occurred_precision : "year",
        title_ko: cleanText(item.title_ko), fact_ko: cleanText(item.fact_ko),
        trajectory_track: item.trajectory_track === "technology" ? "technology" : "market",
        layer_key: normalizeLayerKey(item.layer_key),
        source_name: cleanText(item.source_name), source_url: cleanUrl(item.source_url)
      })).filter((item) => item.title_ko && item.fact_ko && item.source_url)
    };
  }
  return out;
}

function serializeEvents(label, name, events) {
  if (!events.length) return `[${label}] ${name}: 확인된 이벤트 없음`;
  const trackLabel = (event) => (event.track === "tech" || event.track === "technology" ? "technology" : "market");
  const lines = events.map((event) =>
    `- id=${event.id || "-"} | [track=${trackLabel(event)}] | ${event.date || "시점미상"} | ${String(event.title || "").slice(0, 120)} | ${String(event.fact || "").replace(/\s+/g, " ").slice(0, 240)} | 출처: ${event.sourceName || "미상"}`
  );
  return `[${label}] ${name} (${events.length}건)\n${lines.join("\n")}`;
}

export async function buildCompareReport({ nameA, nameB, eventsA, eventsB }) {
  const evidence = `${serializeEvents("A", nameA, eventsA)}\n\n${serializeEvents("B", nameB, eventsB)}`;

  const draft = await createJsonResponse({
    name: "compare_report_draft",
    schema: REPORT_SHAPE,
    provider: "openai",
    instructions:
      `당신은 중국 이차전지 산업 분석가다. 두 회사 ${nameA}(A)와 ${nameB}(B)를 시장 축과 기술 축으로 나눠 비교하는 리포트를 한국어로 쓴다. ` +
      `${AXIS_RULE} ${FACT_RULE} ${INSIGHT_RULE} ${LENGTH_GUIDE}`,
    input: `비교 대상 A: ${nameA}\n비교 대상 B: ${nameB}\n\n화면에 표시된 근거 이벤트:\n${evidence}`
  });

  // 검증 단계. 초안의 사실관계를 웹으로 한 번 대조하고, 확인된 최신 근거를 덧붙인다.
  // 검색이 실패하거나 형식이 깨져도 리포트 자체는 남아야 하므로 초안으로 되돌린다.
  try {
    const verified = await createJsonResponse({
      name: "compare_report_verified",
      schema: VERIFIED_SHAPE,
      provider: "openai",
      webSearch: true,
      instructions: `${VERIFY_RULE} ${AXIS_RULE} ${FACT_RULE} ${INSIGHT_RULE} ${LENGTH_GUIDE}`,
      input: `비교 대상 A: ${nameA}\n비교 대상 B: ${nameB}\n\n원래 근거 이벤트:\n${evidence}\n\n검증할 초안:\n${JSON.stringify(draft.data)}`
    });
    return { report: cleanReport(verified.data), model: verified.model, searched_sources: verified.sourceUrls || [], verification_status: "verified" };
  } catch (error) {
    console.error("[COMPARE_REPORT_VERIFY_FAILED]", JSON.stringify({ message: error.message }));
    return {
      report: {
        ...cleanReport(draft.data),
        verification: { checked_ko: "웹 검증 단계가 실패해 초안 그대로입니다. 사실관계를 원문으로 다시 확인해 주세요.", corrections: [], added_evidence: [] }
      },
      model: draft.model,
      searched_sources: [],
      verification_status: "draft_only"
    };
  }
}

// ── 검증 결과를 DB에 되돌린다 ─────────────────────────────────────────
// 날짜 수정은 우리 이벤트의 시점만 고친다. 사실 문장은 건드리지 않는다. 검증자가 본 문서의
// 주소를 occurred_basis에 남겨 누가 왜 바꿨는지 추적되게 한다.
// 새 사실은 web_backfill(참고 등급) 이벤트로 넣는다. 기사 본문 대조를 거치지 않았으므로
// 핵심 등급을 주지 않는다. 화면에서 "보조 데이터 포함"을 켜야 보인다.
export async function applyVerifiedFacts({ companyA, companyB, report, knownEventIds }) {
  const summary = { dates_fixed: 0, events_added: 0, embedded: 0, skipped: [] };
  const verification = report.verification || {};
  const known = new Set(knownEventIds || []);

  for (const item of verification.corrections || []) {
    if (item.field !== "occurred_at" || !item.event_id || !known.has(item.event_id)) continue;
    if (!item.occurred_at || !item.source_url) { summary.skipped.push(`날짜 수정에 날짜나 출처가 없음: ${item.event_id}`); continue; }
    try {
      await supabaseRest(`event?id=eq.${encodeURIComponent(item.event_id)}`, {
        method: "PATCH",
        body: {
          occurred_at: item.occurred_at,
          occurred_precision: item.occurred_precision || "day",
          occurred_basis: `비교 리포트 웹 검증: ${item.reason_ko} (${item.source_url})`.slice(0, 500)
        }
      });
      summary.dates_fixed += 1;
    } catch (error) {
      summary.skipped.push(`날짜 수정 실패 ${item.event_id}: ${error.message}`);
    }
  }

  const byCompany = { A: companyA, B: companyB };
  const rows = [];
  for (const item of verification.added_evidence || []) {
    const company = byCompany[item.company];
    if (!company || !item.occurred_at) { summary.skipped.push(`추가 근거에 회사나 날짜가 없음: ${item.title_ko}`); continue; }
    // layer_key가 있으면 그 소속으로 트랙을 맞춰 시장/기술이 어긋나지 않게 한다.
    const layerKey = item.layer_key || null;
    const track = layerKey ? (layerKey.startsWith("technology-") ? "technology" : "market") : (item.trajectory_track === "technology" ? "technology" : "market");
    rows.push({
      company_id: company.id,
      occurred_at: item.occurred_at,
      occurred_precision: item.occurred_precision,
      occurred_basis: `비교 리포트 웹 검증에서 확인 (${item.source_url})`.slice(0, 500),
      title_ko: item.title_ko.slice(0, 200),
      fact_ko: item.fact_ko.slice(0, 1000),
      trajectory_track: track,
      layer_key: layerKey,
      region_scope: null,
      source_url: item.source_url,
      source_name: item.source_name || "웹 검증",
      original_excerpt: null,
      original_excerpt_ko: null,
      timeline_eligibility: "reference",
      evidence_kind: "web_backfill",
      entity_names: matchGroupEntities(company.id, `${item.title_ko} ${item.fact_ko}`),
    });
  }
  if (rows.length) {
    const ids = [...new Set(rows.map((row) => row.company_id))];
    const existing = await supabaseRest(`event?select=company_id,occurred_at,title_ko&company_id=in.(${ids.join(",")})`);
    const key = (row) => JSON.stringify([row.company_id, row.occurred_at, row.title_ko]);
    const seen = new Set(existing.map(key));
    const fresh = rows.filter((row) => !seen.has(key(row)));
    if (fresh.length) {
      const stored = await supabaseRest("event", { method: "POST", prefer: "return=representation", body: fresh });
      summary.events_added = (stored || []).length;
      try {
        const nameOf = (id) => (id === companyA.id ? companyA : companyB).name_ko;
        summary.embedded = (await embedEvents((stored || []).map((row) => ({ ...row, company_name_ko: nameOf(row.company_id) })))).chunks;
      } catch (error) {
        summary.skipped.push(`임베딩 실패: ${error.message}`);
      }
    }
  }
  return summary;
}
