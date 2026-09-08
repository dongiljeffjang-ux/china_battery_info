import { createJsonResponse } from "./llm-provider.js";
import { stripCitations } from "./event-backfill.js";
import { supabaseRest } from "./supabase.js";
import { embedEvents } from "./vector-ingestion.js";
import { matchGroupEntities } from "./company-groups.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "./timeline-layers.js";
import { summarizeConceptGraph } from "./concept-graph.js";

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
  required: ["headline_ko", "pair_lite", "trajectory", "comparison", "korea_insight"],
  properties: {
    headline_ko: { type: "string" },
    pair_lite: {
      type: "object", additionalProperties: false,
      required: ["scope_ko", "comparability_ko", "counter_hypothesis_ko", "data_gaps_ko", "korea_scenarios_ko"],
      properties: {
        scope_ko: { type: "string" },
        comparability_ko: { type: "string" },
        counter_hypothesis_ko: { type: "string" },
        data_gaps_ko: { type: "string" },
        korea_scenarios_ko: { type: "string" },
      }
    },
    // 1단계: 두 회사를 시기별로 맞대는 대신, 각 회사의 시장·기술 궤적(추이)을 먼저 시간 순으로 분석한다.
    trajectory: {
      type: "object", additionalProperties: false,
      required: ["a", "b"],
      properties: {
        a: {
          type: "object", additionalProperties: false,
          required: ["market_ko", "technology_ko"],
          properties: { market_ko: { type: "string" }, technology_ko: { type: "string" } }
        },
        b: {
          type: "object", additionalProperties: false,
          required: ["market_ko", "technology_ko"],
          properties: { market_ko: { type: "string" }, technology_ko: { type: "string" } }
        }
      }
    },
    // 2단계: 1단계에서 파악한 두 회사의 궤적을 축별로 비교하고, 갈라지는 지점을 짚는다.
    comparison: {
      type: "object", additionalProperties: false,
      required: ["market_ko", "technology_ko", "divergence_ko"],
      properties: { market_ko: { type: "string" }, technology_ko: { type: "string" }, divergence_ko: { type: "string" } }
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

const TRAJECTORY_RULE =
  "리포트는 두 단계로 쓴다. 먼저 각 회사의 궤적(추이)을 따로 분석하고, 그 다음 두 회사를 비교한다. 같은 시기끼리 단순 대조하지 않는다. " +
  "trajectory.a와 trajectory.b는 각 회사가 시간에 따라 어떻게 움직여 왔는지의 흐름이다. market_ko에는 실적·생산능력·출하·고객·해외가 시기별로 어떻게 늘거나 줄고 방향이 어떻게 바뀌었는지를, technology_ko에는 소재·공정·특허·신제품 개발이 어떤 순서로 진전됐는지를 시간 순 흐름으로 서술한다(예: '2023년 …에서 2025년 …로'). 근거 이벤트가 여러 해에 걸쳐 있으면 그 변화의 방향과 속도를 읽어 준다. " +
  "셀·양극재·음극재 회사는 동일 제품 시장의 직접 경쟁사로 놓고 절대 수치의 우열을 매기면 안 된다. 그러나 셀 생산에는 양극재와 음극재가 필요한 밸류체인 연결이 있으므로, 소재사의 증설·기술 전환은 upstream 공급 신호로, 셀사의 생산·출하·고객 변화는 downstream 수요 신호로 읽어 산업 전체의 흐름을 조망한다. " +
  "comparison은 1단계에서 파악한 두 궤적을 축별로 견준다. market_ko는 두 회사의 시장 궤적이 어떻게 다른지, technology_ko는 기술 궤적이 어떻게 다른지, divergence_ko는 두 회사가 결정적으로 갈라지는 지점을 짚는다. 밸류체인이 다른 경우에도 '동일선상 비교불가'로 끝내지 말고, 연결되는 공급·수요·기술 전환의 경로와 시차를 설명한다. 직접 거래·고객·화학계가 입력에 없으면 그 연결은 잠정 해석임을 밝힌다.";

const LENGTH_GUIDE =
  "A4 한 장에 담아야 하므로 분량을 지킨다. headline_ko는 두 회사의 궤적 차이를 한 문장으로 요약한다. " +
  "trajectory.a·b의 market_ko와 technology_ko는 각각 두세 문장으로 흐름을 쓴다. " +
  "comparison의 market_ko·technology_ko는 각각 두 문장, divergence_ko도 두 문장으로 쓴다. " +
  "korea_insight의 implication_ko는 한 문장, point_ko는 두세 문장, basis_ko는 한 문장 안으로 쓴다. 개조식으로 끊지 말고 줄글로 쓴다.";

const AXIS_RULE =
  "market(시장 축)에는 실적·매출·이익, 생산능력·출하·가동률, 고객·수주·공급계약, 증설·투자, 해외 진출처럼 사업·시장에 관한 사실만 쓴다. " +
  "technology(기술 축)에는 소재·화학 조성, 공정·성능, 특허·표준·인증, 신제품 개발·양산 단계처럼 기술에 관한 사실만 쓴다. " +
  "각 이벤트에는 [track=market] 또는 [track=technology] 표시가 붙어 있으니 그 축에 해당하는 절에만 쓰고 두 축을 섞지 않는다. " +
  "한 축에 해당 이벤트가 없으면 그 절의 a_ko 또는 b_ko에 '해당 축에서 확인된 사실이 없습니다.'라고 쓴다.";

const FACT_RULE =
  "제공된 이벤트에 적힌 사실만 근거로 쓴다. 화면에 없는 수치와 사건을 지어내지 않는다. " +
  "회사명은 제공된 한국어 표준명을 그대로 쓴다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다. " +
  "trajectory와 comparison은 사실을 중심으로 쓰되, 여러 이벤트의 순서와 밸류체인 연결을 엮는 제한적 해석은 허용한다. 이 해석에는 '[교차추론]'을 붙이고, 어떤 사실들의 연결인지·가능한 시차·다른 설명 또는 판정 불가 사유를 짧게 함께 쓴다. korea_insight는 한국 소재사에 대한 해석이다. " +
  "본문 어디에도 URL·마크다운 링크·괄호 안 출처 표기를 넣지 않는다. 출처는 verification.added_evidence에만 쓴다. " +
  "한국어 문장 안에 한자나 다른 문자 체계의 글자를 섞지 않는다. " +
  "trajectory.a·b의 문장은 회사명으로 시작하지 않는다. 화면이 회사명을 제목으로 따로 붙이므로 '2023년 …' 처럼 사실로 바로 시작한다. " +
  "숫자는 '661GWh', '3,448억 위안', '+33.9%'처럼 단위와 함께 짧게 쓴다.";

const INSIGHT_RULE =
  "korea_insight는 한국 배터리 셀사·양극재·음극재 소재사의 임원이자 시장 애널리스트의 눈으로 쓴다. " +
  "implication_ko에는 두 회사의 이 차이가 한국의 어느 쪽(예: 삼원계 양극재사, LFP 양극재사, 인조흑연 음극재사, 셀사)에 상대적으로 유리해질 수 있는지 또는 압박이 될 수 있는지를 한 문장으로 먼저 결론 짓는다. " +
  "point_ko에는 왜 그런지를 경쟁 구도·수요 구조·원가와 기술 흐름·공급망 위치 가운데 해당하는 축으로 설명한다. " +
  "사실을 되풀이하는 요약을 쓰지 않고, '확인해야 한다'·'점검이 필요하다'·'대응해야 한다' 같은 행동 지시나 할 일 목록을 쓰지 않는다. " +
  "제공된 사실로 설명되는 범위 안에서 한 단계까지만 추론하고, 여러 단계를 건너뛴 결론은 쓰지 않는다. 한국 기업의 내부 사정은 알 수 없으므로 한국 쪽은 세부 회사명이 아니라 사업 부문 단위로 말한다. " +
  "단정하기 어려운 대목은 가능성으로 표현하되, 모든 문장을 '가능성이 있다'로 끝내지 말고 방향(유리·압박·중립)은 분명히 한다.";

const PAIR_LITE_RULE =
  "입력의 pair_context는 밸류체인 태그와 화면 이벤트로 계산한 잠정 범위다. 고객·실거래·화학계가 입력에 없으면 추정하지 말고 미확보로 둔다. " +
  "서로 다른 밸류체인 위치라는 사실은 비교를 포기할 이유가 아니다. 같은 제품 단위의 직접 우열 비교만 피하고, upstream 소재 공급·기술 변화와 downstream 셀 수요·생산 변화가 산업 흐름에서 어떻게 맞물릴 수 있는지는 제한적으로 추론한다. " +
  "같은 기간·같은 단위끼리만 비교하고, 연간·반기·분기·1~5월을 연환산하지 않는다. 비교 불가한 수치는 '비교불가'와 이유를 쓴다. " +
  "특허·출원·누적 Capa 같은 stock은 연속 시점이 있을 때만 구간 증분으로 해석하고, 빈 이벤트 구간은 사건 부재가 아니라 데이터 공백으로 둔다. " +
  "매출·이익의 증감은 물량·판가를 분리할 근거가 없으면 '판가 요인 미분리'를 붙이고, 제품군이 다른 톤수·매출·특허로 우열을 말하지 않는다. " +
  "comparison.divergence_ko에는 근거가 있는 갈린 지점과 함께 대안 설명 또는 판정 불가 사유를 한 문장으로 병기한다. " +
  "korea_insight의 point_ko에는 압박과 기회·무영향 가운데 입력 근거가 허용하는 서로 다른 시나리오와 이를 가를 관찰 기준을 짧게 병기한다. " +
  "pair_lite.scope_ko에는 pair_context의 관계와 실제 비교 범위를, comparability_ko에는 같은 기간·단위로 비교 가능한 지표와 비교불가 사유를 쓴다. " +
  "pair_lite.counter_hypothesis_ko에는 갈린 흐름을 설명하는 대안 가설 또는 판정 불가 사유를, data_gaps_ko에는 데이터 공백 때문에 확정할 수 없는 판단을 쓴다. " +
  "pair_lite.korea_scenarios_ko에는 한국 소재사에 대한 압박과 기회·무영향의 서로 다른 시나리오 및 이를 가를 관찰 기준을 쓴다. " +
  "pair_lite의 다섯 문장은 각각 [사실]·[추론]·[교차추론]·[미확보] 중 하나로 시작한다. " +
  "자사 공시·IR·보도자료만 근거인 지표는 '자사발·제3자 미검증'이라고 밝혀 결론 강도를 낮춘다.";

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
  out.pair_lite = Object.fromEntries(Object.entries(report.pair_lite || {}).map(([key, value]) => [key, cleanText(value)]));
  out.trajectory = {
    a: { market_ko: cleanText(report.trajectory?.a?.market_ko), technology_ko: cleanText(report.trajectory?.a?.technology_ko) },
    b: { market_ko: cleanText(report.trajectory?.b?.market_ko), technology_ko: cleanText(report.trajectory?.b?.technology_ko) },
  };
  out.comparison = Object.fromEntries(Object.entries(report.comparison || {}).map(([key, value]) => [key, cleanText(value)]));
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

// 개념 그래프(lib/concept-graph.js) 요약을 리포트 프롬프트용 텍스트로 바꾼다. LLM이 텍스트만
// 보고 "누가 먼저 다뤘는지"·"어느 쪽에만 있는지"를 추론하는 대신, 이미 계산된 사실로 준다.
// 데이터가 아직 얇을 수 있으니 없으면 빈 문자열을 돌려 프롬프트에 빈 절을 남기지 않는다.
function serializeConceptGraph(nameA, nameB, summary) {
  if (!summary || (!summary.shared_concepts.length && !summary.only_a.length && !summary.only_b.length)) return "";
  const lines = [];
  if (summary.shared_concepts.length) {
    lines.push("공통 개념(먼저 다룬 쪽):");
    for (const item of summary.shared_concepts.slice(0, 20)) {
      const leaderLabel = item.leader === "A" ? nameA : item.leader === "B" ? nameB : "동시";
      lines.push(`- ${item.term}: ${leaderLabel} 먼저 (A ${item.first_seen_a} / B ${item.first_seen_b})`);
    }
  }
  if (summary.only_a.length) lines.push(`${nameA}에만 있는 개념: ${summary.only_a.slice(0, 20).join(", ")}`);
  if (summary.only_b.length) lines.push(`${nameB}에만 있는 개념: ${summary.only_b.slice(0, 20).join(", ")}`);
  return `[개념 그래프 신호] (A ${summary.edges_a}건, B ${summary.edges_b}건에서 뽑음)\n${lines.join("\n")}`;
}

const CONCEPT_GRAPH_RULE =
  "[개념 그래프 신호]가 있으면 그 안의 선후관계·전용 개념을 trajectory·comparison·divergence_ko를 쓸 때 참고한다. " +
  "다만 이건 보조 신호일 뿐이니 본문에 '개념 그래프'라는 말을 쓰지 않고, 사실 문장으로 자연스럽게 풀어 쓴다. 이 신호가 비어 있으면 무시한다.";

export async function buildCompareReport({ companyIdA, companyIdB, nameA, nameB, eventsA, eventsB, pairContext }) {
  let conceptGraphText = "";
  try {
    if (companyIdA && companyIdB) {
      const summary = await summarizeConceptGraph({ companyIdA, companyIdB });
      conceptGraphText = serializeConceptGraph(nameA, nameB, summary);
    }
  } catch (error) {
    console.error("[COMPARE_REPORT_CONCEPT_GRAPH_FAILED]", JSON.stringify({ companyIdA, companyIdB, message: error.message }));
  }
  const evidence = [pairContext ? "[비교 관계·근거 커버리지]\n" + JSON.stringify(pairContext) : "", serializeEvents("A", nameA, eventsA), serializeEvents("B", nameB, eventsB), conceptGraphText].filter(Boolean).join("\n\n");

  const draft = await createJsonResponse({
    name: "compare_report_draft",
    schema: REPORT_SHAPE,
    provider: "openai",
    instructions:
      `당신은 중국 이차전지 산업 분석가다. 두 회사 ${nameA}(A)와 ${nameB}(B)를 비교하는 리포트를 한국어로 쓴다. 먼저 각 회사의 시장·기술 궤적을 시간 순으로 분석하고, 그 다음 두 궤적을 비교한다. ` +
      `${TRAJECTORY_RULE} ${AXIS_RULE} ${FACT_RULE} ${INSIGHT_RULE} ${PAIR_LITE_RULE} ${LENGTH_GUIDE} ${CONCEPT_GRAPH_RULE}`,
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
      instructions: `${VERIFY_RULE} ${TRAJECTORY_RULE} ${AXIS_RULE} ${FACT_RULE} ${INSIGHT_RULE} ${PAIR_LITE_RULE} ${LENGTH_GUIDE} ${CONCEPT_GRAPH_RULE}`,
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

// ── 리포트 함의 종합 ───────────────────────────────────────────────────
// 이미 만들어진 비교 리포트 여러 건을 재료로, 리포트들을 가로지르는 공통 흐름·갈리는 지점·한국 기업
// 관점 함의를 뽑는다. 웹 검색은 쓰지 않는다. 재료가 된 리포트는 이미 만들 때 웹 검증을 거쳤고, 여기서
// 또 검색을 열면 "리포트에 있던 것"과 "새로 찾은 것"이 섞여 근거를 짚을 수 없게 된다.
// 결과는 사실이 아니라 해석이므로 화면에서 통째로 해석 영역으로 표시한다.

const SYNTHESIS_ITEM = {
  type: "object", additionalProperties: false,
  required: ["theme_ko", "finding_ko", "basis_ko", "report_refs"],
  properties: {
    theme_ko: { type: "string" },
    finding_ko: { type: "string" },
    // 그 판단의 근거가 된 리포트 속 사실을 회사명·수치와 함께 한 문장으로.
    basis_ko: { type: "string" },
    // 근거가 나온 리포트 번호(입력의 [R1], [R2]…에서 1부터).
    report_refs: { type: "array", items: { type: "integer" } },
  },
};

const SYNTHESIS_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["title_ko", "headline_ko", "threads", "contrasts", "korea_implications", "limits_ko"],
  properties: {
    title_ko: { type: "string" },
    headline_ko: { type: "string" },
    // 여러 리포트에 걸쳐 되풀이되는 흐름.
    threads: { type: "array", minItems: 1, maxItems: 4, items: SYNTHESIS_ITEM },
    // 리포트끼리 방향이 다르거나 회사군이 갈리는 지점.
    contrasts: { type: "array", maxItems: 3, items: SYNTHESIS_ITEM },
    korea_implications: {
      type: "array", minItems: 2, maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["segment", "implication_ko", "point_ko", "basis_ko", "report_refs"],
        properties: {
          segment: { type: "string", enum: SEGMENTS },
          implication_ko: { type: "string" },
          point_ko: { type: "string" },
          basis_ko: { type: "string" },
          report_refs: { type: "array", items: { type: "integer" } },
        },
      },
    },
    // 이 종합이 다루지 못한 것. 리포트 수·기간 차이·근거 범위 차이 같은 한계.
    limits_ko: { type: "string" },
  },
};

export const REPORT_SYNTHESIS_PROMPT =
  "당신은 중국 이차전지 산업 분석가다. 입력은 이미 작성·검증된 기업 비교 리포트 여러 건이다. 각 리포트는 [R1], [R2]처럼 번호가 붙어 있다. " +
  "이 리포트들에 적힌 사실·궤적·비교 서술만 근거로 리포트들을 가로지르는 함의를 한국어로 종합한다. 리포트에 없는 수치·사건·회사를 만들지 않고 웹 검색을 쓰지 않는다. " +
  "threads에는 두 건 이상의 리포트에서 되풀이되는 흐름을 쓴다. 리포트 한 건에만 나온 내용은 threads에 넣지 않는다. " +
  "contrasts에는 리포트끼리 방향이 다르거나 회사군이 갈리는 지점을 쓴다. 없으면 빈 배열로 둔다. " +
  "threads·contrasts의 finding_ko는 두세 문장의 줄글로 쓰고, basis_ko에는 근거가 된 리포트 속 사실을 회사명과 수치로 한 문장에 담으며, report_refs에는 그 근거가 나온 리포트 번호를 모두 적는다. " +
  "korea_implications는 한국 배터리 셀사·양극재·음극재 소재사의 임원이자 시장 애널리스트의 눈으로 쓴다. implication_ko에는 이 흐름이 한국의 어느 쪽(예: 삼원계 양극재사, LFP 양극재사, 인조흑연 음극재사, 셀사)에 상대적으로 유리해질 수 있는지 또는 압박이 될 수 있는지를 한 문장으로 먼저 결론 짓고, point_ko에는 왜 그런지를 경쟁 구도·수요 구조·원가와 기술 흐름·공급망 위치 가운데 해당하는 축으로 두세 문장에 설명한다. 항목은 서로 다른 주제를 다룬다. " +
  "리포트가 이미 담고 있는 사실로 설명되는 범위 안에서 한 단계까지만 추론한다. 여러 단계를 건너뛴 결론, 리포트 근거로 설명할 수 없는 결론은 쓰지 않는다. 단정하기 어려운 대목은 가능성으로 표현하되 방향(유리·압박·중립)은 분명히 한다. " +
  "'확인해야 한다', '점검이 필요하다', '대응해야 한다' 같은 행동 지시나 할 일 목록을 쓰지 않는다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다. " +
  "title_ko는 이 종합의 제목을 열 자 안팎의 명사구로, headline_ko는 리포트들을 관통하는 그림을 두 문장으로 쓴다. limits_ko에는 이 종합이 다루지 못한 것(리포트 수, 기간·근거 범위 차이, 회사 구성의 치우침)을 한두 문장으로 적는다. " +
  "회사명은 리포트의 한국어 표준명을 그대로 쓴다. 본문에 URL·마크다운·괄호 안 출처 표기를 넣지 않고, 한국어 문장에 한자를 섞지 않는다. 숫자는 '661GWh', '3,448억 위안', '+33.9%'처럼 단위와 함께 짧게 쓴다.";

// 비교 리포트 한 건을 종합 프롬프트용 텍스트로 편다. 사실 절과 해석 절을 표시해 모델이 구분하게 한다.
function serializeReportForSynthesis(index, row) {
  const report = row.report || {};
  const traj = report.trajectory || {};
  const cmp = report.comparison || {};
  const points = (report.korea_insight?.points || []).map((item) =>
    `  - [${item.segment}] ${item.implication_ko} — ${item.point_ko} (근거: ${item.basis_ko})`);
  const lines = [
    `[R${index}] ${row.company_a_name_ko}(A) vs ${row.company_b_name_ko}(B) · 생성 ${String(row.created_at || "").slice(0, 10)} · 근거 범위 ${row.include_supporting ? "공시·핵심 + 보조(참고)" : "공시·핵심만"} · 웹 검증 ${row.verification_status || "미상"}`,
    `헤드라인: ${report.headline_ko || ""}`,
    `A ${row.company_a_name_ko} 궤적(사실) · 시장: ${traj.a?.market_ko || ""} · 기술: ${traj.a?.technology_ko || ""}`,
    `B ${row.company_b_name_ko} 궤적(사실) · 시장: ${traj.b?.market_ko || ""} · 기술: ${traj.b?.technology_ko || ""}`,
    `비교(사실) · 시장: ${cmp.market_ko || ""} · 기술: ${cmp.technology_ko || ""} · 갈린 지점: ${cmp.divergence_ko || ""}`,
    points.length ? `한국 관점(해석):\n${points.join("\n")}` : "한국 관점(해석): 없음",
    report.verification?.checked_ko ? `검증 메모: ${report.verification.checked_ko}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function cleanSynthesisItem(item, count) {
  return {
    theme_ko: cleanText(item?.theme_ko), finding_ko: cleanText(item?.finding_ko), basis_ko: cleanText(item?.basis_ko),
    report_refs: [...new Set((item?.report_refs || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))],
  };
}

export async function buildReportSynthesis({ reports }) {
  const input = reports.map((row, index) => serializeReportForSynthesis(index + 1, row)).join("\n\n");
  const result = await createJsonResponse({
    name: "report_synthesis",
    schema: SYNTHESIS_SHAPE,
    provider: "openai",
    // 리포트 여섯 건이면 입력이 길고 출력도 항목 열 개 안팎이라 기본 45초로는 빠듯하다.
    timeoutMs: 90000,
    instructions: REPORT_SYNTHESIS_PROMPT,
    input: `비교 리포트 ${reports.length}건:\n\n${input}`,
  });
  const data = result.data || {};
  const count = reports.length;
  const synthesis = {
    title_ko: cleanText(data.title_ko),
    headline_ko: cleanText(data.headline_ko),
    threads: (data.threads || []).map((item) => cleanSynthesisItem(item, count)).filter((item) => item.finding_ko),
    contrasts: (data.contrasts || []).map((item) => cleanSynthesisItem(item, count)).filter((item) => item.finding_ko),
    korea_implications: (data.korea_implications || []).map((item) => ({
      segment: SEGMENTS.includes(item?.segment) ? item.segment : "전반",
      implication_ko: cleanText(item?.implication_ko), point_ko: cleanText(item?.point_ko), basis_ko: cleanText(item?.basis_ko),
      report_refs: cleanSynthesisItem(item, count).report_refs,
    })).filter((item) => item.point_ko),
    limits_ko: cleanText(data.limits_ko),
  };
  return { synthesis, model: result.model };
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
