import assert from "node:assert/strict";
import { buildEventDisplaySummaryInput, cleanDisplaySummary, eventDisplaySummarySchema, EVENT_DISPLAY_SUMMARY_BATCH_SIZE } from "../lib/event-display-summary.js";

assert.equal(cleanDisplaySummary(" ·  2026년 상반기 매출은 3,448억 위안이다. "), "2026년 상반기 매출은 3,448억 위안이다.");
assert.equal(cleanDisplaySummary("가".repeat(140)).length, 120, "화면용 요약은 길이 상한을 지킨다");
const input = buildEventDisplaySummaryInput([{ id: "event-1", title_ko: "상반기 매출", fact_ko: "매출은 100억 위안이다.", original_excerpt_ko: "원문 번역" }]);
assert.match(input, /event-1/);
assert.match(input, /원문 번역/);
const schema = eventDisplaySummarySchema();
assert.equal(schema.properties.summaries.maxItems, EVENT_DISPLAY_SUMMARY_BATCH_SIZE);
assert.equal(schema.properties.summaries.items.additionalProperties, false);

console.log("ok  event-display-summary");
