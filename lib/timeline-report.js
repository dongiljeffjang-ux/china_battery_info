import { createJsonResponse } from "./llm-provider.js";

const TRACKS = ["market", "tech"];

const POINT = {
  type: "object", additionalProperties: false,
  required: ["period_ko", "track", "finding_ko", "basis_event_ids"],
  properties: {
    period_ko: { type: "string" },
    track: { type: "string", enum: TRACKS },
    finding_ko: { type: "string" },
    basis_event_ids: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
  },
};

const REPORT_SHAPE = {
  type: "object", additionalProperties: false,
  required: ["headline_ko", "market_trajectory_ko", "technology_trajectory_ko", "turning_points", "current_position_ko", "limits_ko"],
  properties: {
    headline_ko: { type: "string" },
    market_trajectory_ko: { type: "string" },
    technology_trajectory_ko: { type: "string" },
    turning_points: { type: "array", maxItems: 6, items: POINT },
    current_position_ko: { type: "string" },
    limits_ko: { type: "string" },
  },
};

export const TIMELINE_REPORT_PROMPT = "당신은 중국 이차전지 기업의 시계열 사실을 읽는 산업 분석가다. 입력된 한 회사의 시장·기술 이벤트만 근거로 한국어 시계열 리포트를 쓴다. 웹 검색, 일반 지식, 입력에 없는 수치·고객·계획을 쓰지 않는다. market_trajectory_ko와 technology_trajectory_ko는 각각 시간 순 변화만 요약한다. 입력 근거가 부족한 축은 부족하다고 명시한다. turning_points는 실제 변곡점만 0~6개 고르고, 각 항목의 basis_event_ids에는 입력 이벤트 ID를 1~3개만 넣는다. finding_ko에는 그 근거로 바로 설명되는 한 단계 해석만 쓴다. current_position_ko는 가장 최근 근거가 보여 주는 위치를 설명할 뿐 전망이나 추천을 하지 않는다. limits_ko에는 기간·출처·빠진 축 같은 해석 한계를 적는다. 사실과 해석을 섞지 말고, 주가·매수매도·목표주가·투자 추천·행동 지시는 어떤 형태로도 쓰지 않는다.";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();

export async function buildTimelineReport({ companyName, events }) {
  const ids = new Set(events.map(event => event.id));
  const evidence = events.map(event => `[${event.id}] ${event.date} | ${event.track === "tech" ? "기술" : "시장"} | ${event.layer || "미분류"} | ${event.title}\n${event.fact}\n출처: ${event.sourceName}`).join("\n\n");
  const { data, model } = await createJsonResponse({
    name: "company_timeline_report",
    provider: "openai",
    timeoutMs: 85000,
    schema: REPORT_SHAPE,
    instructions: TIMELINE_REPORT_PROMPT,
    input: `회사: ${companyName}\n\n시계열 근거 이벤트:\n${evidence}`,
  });
  return {
    report: {
      headline_ko: clean(data.headline_ko),
      market_trajectory_ko: clean(data.market_trajectory_ko),
      technology_trajectory_ko: clean(data.technology_trajectory_ko),
      turning_points: (data.turning_points || []).map(point => ({
        period_ko: clean(point.period_ko),
        track: point.track === "tech" ? "tech" : "market",
        finding_ko: clean(point.finding_ko),
        basis_event_ids: (point.basis_event_ids || []).filter(id => ids.has(id)).slice(0, 3),
      })).filter(point => point.finding_ko && point.basis_event_ids.length),
      current_position_ko: clean(data.current_position_ko),
      limits_ko: clean(data.limits_ko),
    },
    model,
  };
}
