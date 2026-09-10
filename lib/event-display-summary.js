import { createJsonResponse } from "./llm-provider.js";
import { hasDatabaseConfig, supabaseRest } from "./supabase.js";

// 한 요청에서 지나치게 많은 보고서 문장을 보내면 요약 품질과 함수 응답 시간이 함께 나빠진다.
// 화면은 브라우저가 다음 배치를 이어 호출한다.
export const EVENT_DISPLAY_SUMMARY_BATCH_SIZE = 16;

const REPORT_EVENT_KINDS = "annual_report,periodic_report";

export function cleanDisplaySummary(value) {
  return String(value || "")
    .replace(/^[\s•·\-*–—]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function eventDisplaySummarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summaries"],
    properties: {
      summaries: {
        type: "array",
        maxItems: EVENT_DISPLAY_SUMMARY_BATCH_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "summary_ko"],
          properties: {
            id: { type: "string" },
            summary_ko: { type: "string" }
          }
        }
      }
    }
  };
}

export function buildEventDisplaySummaryInput(events) {
  return JSON.stringify({
    events: events.map((event) => ({
      id: event.id,
      title_ko: event.title_ko,
      fact_ko: event.fact_ko,
      original_excerpt_ko: event.original_excerpt_ko || ""
    }))
  });
}

const DISPLAY_SUMMARY_INSTRUCTIONS = `
입력은 중국 배터리 기업의 연차·반기·분기 보고서에서 이미 추출·검증된 이벤트다.
각 이벤트마다 화면에서 제목 아래에 보일 한국어 요약 한 문장만 작성한다.

- 입력의 fact_ko와 original_excerpt_ko에 있는 사실만 사용한다. 원인·전망·평가·추론을 더하지 않는다.
- 제목을 반복하지 말고, 가장 중요한 수치·변화·대상 중 하나를 짧고 자연스러운 한국어로 쓴다.
- 중국어·영어 원문을 그대로 남기지 않는다. 고유명사·공식 약어·단위는 필요한 경우만 한국어 표기와 함께 쓴다.
- 문장 하나, 120자 이하, 불릿 기호·제목·출처·'원문' 표기는 쓰지 않는다.
- 일부 이벤트의 정보가 부족해도 비어 있는 요약을 만들지 말고 fact_ko를 자연스럽게 다듬는다.
- 이벤트 ID는 입력에 있는 것을 그대로 반환하고, 입력 밖 ID를 만들지 않는다.
`;

export async function summarizeEventDisplayBatch({ limit = EVENT_DISPLAY_SUMMARY_BATCH_SIZE } = {}) {
  if (!hasDatabaseConfig()) {
    const error = new Error("Database is not configured");
    error.code = "DB_NOT_CONFIGURED";
    throw error;
  }
  const batchSize = Math.min(EVENT_DISPLAY_SUMMARY_BATCH_SIZE, Math.max(1, Number(limit) || EVENT_DISPLAY_SUMMARY_BATCH_SIZE));
  // UPDATE 전에 대상 행을 이 SELECT로 확정한다. 상세 사실과 원문 발췌는 읽기만 하며 절대 고치지 않는다.
  const events = await supabaseRest(`event?select=id,title_ko,fact_ko,original_excerpt_ko&display_summary_ko=is.null&evidence_kind=in.(${REPORT_EVENT_KINDS})&order=occurred_at.desc,id.asc&limit=${batchSize}`);
  if (!events?.length) return { selected: 0, updated: 0, remaining: 0, model: null };

  const result = await createJsonResponse({
    // 보고서 작성용 openai_report가 아니라 뉴스 수집에 쓰는 기본 OpenAI 설정을 명시한다.
    provider: "openai",
    webSearch: false,
    timeoutMs: 45000,
    name: "event_display_summary",
    schema: eventDisplaySummarySchema(),
    instructions: DISPLAY_SUMMARY_INSTRUCTIONS,
    input: buildEventDisplaySummaryInput(events)
  });
  const allowed = new Set(events.map((event) => event.id));
  const updates = new Map();
  for (const item of result.data?.summaries || []) {
    const summary = cleanDisplaySummary(item.summary_ko);
    if (allowed.has(item.id) && summary) updates.set(item.id, summary);
  }
  await Promise.all([...updates].map(([id, summary]) => supabaseRest(`event?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: {
      display_summary_ko: summary,
      display_summary_model: result.model || null,
      display_summarized_at: new Date().toISOString()
    }
  })));
  // 모델이 한 건도 돌려주지 않은 경우에는 같은 미처리 행을 무한 반복하지 않는다.
  return { selected: events.length, updated: updates.size, remaining: events.length === batchSize && updates.size > 0 ? 1 : 0, model: result.model || null };
}
