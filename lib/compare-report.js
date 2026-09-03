import { createJsonResponse } from "./llm-provider.js";
import { stripCitations } from "./event-backfill.js";

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
function cleanReport(report) {
  const out = { ...report };
  out.headline_ko = cleanText(report.headline_ko);
  for (const section of ["strategy", "timeline"]) {
    out[section] = Object.fromEntries(Object.entries(report[section] || {}).map(([key, value]) => [key, cleanText(value)]));
  }
  out.korea_insight = {
    points: (report.korea_insight?.points || []).map((item) => ({ ...item, point_ko: cleanText(item.point_ko), basis_ko: cleanText(item.basis_ko) }))
  };
  if (report.verification) {
    out.verification = {
      checked_ko: cleanText(report.verification.checked_ko),
      corrections: (report.verification.corrections || []).map((item) => ({
        original_ko: cleanText(item.original_ko), corrected_ko: cleanText(item.corrected_ko), reason_ko: cleanText(item.reason_ko)
      })).filter((item) => item.original_ko && item.corrected_ko && item.original_ko !== item.corrected_ko),
      added_evidence: (report.verification.added_evidence || []).map((item) => ({
        fact_ko: cleanText(item.fact_ko), source_name: cleanText(item.source_name), source_url: cleanUrl(item.source_url)
      })).filter((item) => item.fact_ko && item.source_url)
    };
  }
  return out;
}

// 비교 화면에 표시된 두 회사의 이벤트를 근거로 A4 한 장 분량의 비교 리포트를 만든다.
//
// 두 단계로 나눈다.
//   1) 작성: 화면에 있는 사실만 근거로 초안을 만든다. 웹 검색을 쓰지 않는다.
//   2) 검증: 그 초안을 웹 검색 한 번으로 대조해 틀린 대목을 고치고 근거를 덧붙인다.
// 나누는 이유는, 검색을 처음부터 열어 두면 화면에 없는 사실로 글을 쓰고
// 그것이 우리 데이터인지 검색 결과인지 구분되지 않기 때문이다.

const REPORT_SHAPE = {
  type: "object",
  additionalProperties: false,
  required: ["headline_ko", "strategy", "timeline", "korea_insight"],
  properties: {
    headline_ko: { type: "string" },
    strategy: {
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
            required: ["segment", "point_ko", "basis_ko"],
            properties: {
              segment: { type: "string", enum: ["셀", "양극재", "음극재", "공급망", "전반"] },
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
          type: "array", maxItems: 4,
          items: {
            type: "object", additionalProperties: false,
            required: ["original_ko", "corrected_ko", "reason_ko"],
            properties: { original_ko: { type: "string" }, corrected_ko: { type: "string" }, reason_ko: { type: "string" } }
          }
        },
        added_evidence: {
          type: "array", maxItems: 4,
          items: {
            type: "object", additionalProperties: false,
            required: ["fact_ko", "source_name", "source_url"],
            properties: { fact_ko: { type: "string" }, source_name: { type: "string" }, source_url: { type: "string" } }
          }
        }
      }
    }
  }
};

const LENGTH_GUIDE =
  "A4 한 장에 담아야 하므로 분량을 지킨다. headline_ko는 두 회사의 차이를 한 문장으로 요약한다. " +
  "strategy의 a_ko와 b_ko는 각각 두세 문장, contrast_ko는 두 문장으로 쓴다. " +
  "timeline의 a_ko와 b_ko는 각각 두세 문장으로 시점에 따른 움직임의 순서와 속도를 쓰고, divergence_ko는 두 회사가 갈라진 대목을 두 문장으로 쓴다. " +
  "korea_insight의 point_ko는 두세 문장, basis_ko는 한 문장 안으로 쓴다. 개조식으로 끊지 말고 줄글로 쓴다.";

const FACT_RULE =
  "제공된 이벤트에 적힌 사실만 근거로 쓴다. 화면에 없는 수치와 사건을 지어내지 않는다. " +
  "회사명은 제공된 한국어 표준명을 그대로 쓴다. 주가·매수매도·목표주가·투자 추천은 어떤 형태로도 쓰지 않는다. " +
  "strategy와 timeline은 사실 정리이므로 해석을 섞지 않는다. korea_insight만 해석이며, " +
  "한국 배터리 셀사·양극재·음극재 소재사의 임원이자 시장 애널리스트의 눈으로, 두 회사의 차이가 경쟁 구도·수요 구조·원가와 기술 흐름·공급망 위치에서 무엇을 뜻하는지 쓴다. " +
  "사실을 되풀이하는 요약을 쓰지 않고, '확인해야 한다'·'점검이 필요하다'·'대응해야 한다' 같은 행동 지시나 할 일 목록을 쓰지 않는다. 판단과 함의만 쓴다. " +
  "제공된 사실로 설명되는 범위 안에서 한 단계까지만 추론하고, 여러 단계를 건너뛴 결론은 쓰지 않는다. " +
  "단정하기 어려운 대목은 가능성으로 표현한다. " +
  "본문 어디에도 URL·마크다운 링크·괄호 안 출처 표기를 넣지 않는다. 출처는 verification.added_evidence에만 쓴다. " +
  "한국어 문장 안에 한자나 다른 문자 체계의 글자를 섞지 않는다. 고유명사는 제공된 한국어 표준명을 쓴다. " +
  "strategy와 timeline의 a_ko·b_ko는 회사명으로 문장을 시작하지 않는다. 화면이 회사명을 제목으로 따로 붙이므로 '2025년 …' 처럼 사실로 바로 시작한다.";

function serializeEvents(label, name, events) {
  if (!events.length) return `[${label}] ${name}: 확인된 이벤트 없음`;
  const lines = events.map((event) =>
    `- ${event.date || "시점미상"} | ${String(event.title || "").slice(0, 120)} | ${String(event.fact || "").replace(/\s+/g, " ").slice(0, 240)} | 출처: ${event.sourceName || "미상"}`
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
      `당신은 중국 이차전지 산업 분석가다. 두 회사 ${nameA}와 ${nameB}를 비교하는 리포트를 한국어로 쓴다. ` +
      `${FACT_RULE} ${LENGTH_GUIDE}`,
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
      instructions:
        `당신은 독립적인 사실 검증자다. 아래 비교 리포트 초안의 사실관계를 웹 검색으로 한 번 대조한다. ` +
        `틀렸거나 최신이 아닌 대목을 고쳐 본문에 반영하고, 무엇을 어떻게 고쳤는지 verification.corrections에 남긴다. ` +
        `초안이 맞으면 본문을 그대로 두고 corrections를 빈 배열로 둔다. 확인하지 못한 대목은 억지로 고치지 않는다. ` +
        `added_evidence에는 검색으로 확인한 근거만 넣고 source_url에는 실제로 연 문서의 주소를 쓴다. 출처를 지어내지 않는다. ` +
        `checked_ko에는 무엇을 확인했는지 한 문장으로 쓴다. corrections에는 수치·날짜·주체가 실제로 틀린 대목만 넣고 표현만 다듬은 것은 넣지 않는다. 세 건을 넘기지 않는다. ${FACT_RULE} ${LENGTH_GUIDE}`,
      input: `비교 대상 A: ${nameA}\n비교 대상 B: ${nameB}\n\n원래 근거 이벤트:\n${evidence}\n\n검증할 초안:\n${JSON.stringify(draft.data)}`
    });
    return {
      report: cleanReport(verified.data),
      model: verified.model,
      searched_sources: verified.sourceUrls || [],
      verification_status: "verified"
    };
  } catch (error) {
    console.error("[COMPARE_REPORT_VERIFY_FAILED]", JSON.stringify({ message: error.message }));
    return {
      report: {
        ...cleanReport(draft.data),
        verification: {
          checked_ko: "웹 검증 단계가 실패해 초안 그대로입니다. 사실관계를 원문으로 다시 확인해 주세요.",
          corrections: [],
          added_evidence: []
        }
      },
      model: draft.model,
      searched_sources: [],
      verification_status: "draft_only"
    };
  }
}
