import assert from "node:assert/strict";
import { isTimelineBusinessEvent } from "../lib/timeline-visibility.js";

const event = (fact, layer_key = "supply-performance") => ({ layer_key, title_ko: fact, fact_ko: fact });

assert.equal(isTimelineBusinessEvent(event("고부채 피보증 대상에 대한 보증 잔액 18억 위안")), false);
assert.equal(isTimelineBusinessEvent(event("2025년 매출 120억 위안, 순이익 8억 위안")), false);
assert.equal(isTimelineBusinessEvent(event("양극재 출하량 12만 톤으로 증가, 시장점유율 3위")), true);
assert.equal(isTimelineBusinessEvent(event("제품 믹스 개선으로 매출총이익률 4%p 상승")), true);
assert.equal(isTimelineBusinessEvent(event("유럽 고객과 5년 공급계약 체결", "customer-commercialization")), true);

console.log("timeline business visibility checks passed");
