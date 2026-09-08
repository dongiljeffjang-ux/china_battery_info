import assert from "node:assert/strict";
import { buildEventEmbeddingText } from "../lib/vector-ingestion.js";

const base = {
  id: "event-1",
  company_id: "catl",
  company_name_ko: "CATL",
  occurred_at: "2023-12-31",
  title_ko: "신규 공급 계약 체결",
  fact_ko: "고객사와 공급 계약을 체결했다.",
  trajectory_track: "market",
};

const cases = [
  { precision: "year", basis: "연차보고서 기준 · 원문에 시점 표기 없음", expected: "[시점] 2023년 중 (연차보고서 기준 · 원문에 시점 표기 없음)" },
  { precision: "half", basis: "반기보고서 기준", expected: "[시점] 2023년 하반기 (반기보고서 기준)" },
  { precision: "month", basis: "원문: 2023年12月", expected: "[시점] 2023년 12월 (원문: 2023年12月)" },
  { precision: "day", basis: "원문 공시일", expected: "[시점] 2023-12-31 (원문 공시일)" },
];

for (const item of cases) {
  const text = buildEventEmbeddingText({ ...base, occurred_precision: item.precision, occurred_basis: item.basis });
  assert.ok(text.includes(item.expected), `${item.precision} 시점 문구가 정확해야 한다`);
  if (item.precision !== "day") {
    assert.ok(!text.includes("[시점] 2023-12-31\n"), `${item.precision}는 결산일 단독 형식을 쓰면 안 된다`);
  }
}

const firstHalf = buildEventEmbeddingText({ ...base, occurred_at: "2024-06-30", occurred_precision: "half" });
assert.ok(firstHalf.includes("[시점] 2024년 상반기"), "6월 말은 상반기로 표시해야 한다");

const counterparties = buildEventEmbeddingText({
  ...base,
  occurred_precision: "day",
  event_fact: [{ counterparty: "BMW" }, { counterparty: "BMW" }, { counterparty: "Stellantis" }, { counterparty: "" }],
});
assert.ok(counterparties.includes("[상대] BMW, Stellantis"), "상대방은 중복을 제거해 표시해야 한다");

const withoutCounterparty = buildEventEmbeddingText({ ...base, occurred_precision: "day", event_fact: [] });
assert.ok(!withoutCounterparty.includes("[상대]"), "상대방이 없으면 라인을 만들지 않아야 한다");

const longBasis = buildEventEmbeddingText({ ...base, occurred_precision: "year", occurred_basis: "가".repeat(50) });
assert.ok(longBasis.includes(`(${"가".repeat(40)})`), "근거는 40자로 제한해야 한다");
assert.ok(!longBasis.includes("가".repeat(41)), "근거가 40자를 넘으면 안 된다");

console.log("event embedding text checks passed");
