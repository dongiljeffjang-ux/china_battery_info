import assert from "node:assert/strict";
import { processWindowStart } from "../lib/date-window.js";

// 검색은 한국 날짜(YYYY-MM-DD)로 3일 창을 만들고, 날짜만 확인된 기사는 DB에 그 날 00:00Z로 저장한다.
// 따라서 09-14 KST 오전 실행에서도 09-11 날짜 기사가 최근 처리 창에 남아야 한다.
const now = new Date("2026-09-14T00:29:40.270Z");
assert.equal(processWindowStart(3, now), "2026-09-10T15:00:00.000Z");
assert.ok(
  Date.parse("2026-09-11T00:00:00.000Z") >= Date.parse(processWindowStart(3, now)),
  "날짜만 있는 9월 11일 기사가 시각 단위 72시간 경계 때문에 빠지면 안 된다"
);

console.log("process window date-boundary checks passed");
