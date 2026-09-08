import assert from "node:assert/strict";
import { periodWindow, averageRates, FX_SOURCE } from "../lib/fx-rates.js";

// 중국 분기 재무는 누적(YTD)이다. 2025Q3는 1~9월 합이므로 환산에 쓸 환율도 1~9월 평균이어야 한다.
// 기말 환율 하나로 누적 매출을 나누면 연중 환율이 움직인 만큼 틀린다.

assert.deepEqual(periodWindow("2025"), { start: "2025-01-01", end: "2025-12-31" });
assert.deepEqual(periodWindow("2025Q1"), { start: "2025-01-01", end: "2025-03-31" });
assert.deepEqual(periodWindow("2025H1"), { start: "2025-01-01", end: "2025-06-30" }, "반기는 1~6월 누적이다");
assert.deepEqual(periodWindow("2025Q3"), { start: "2025-01-01", end: "2025-09-30" }, "3분기는 1~9월 누적이지 7~9월이 아니다");
assert.equal(periodWindow("2025Q2"), null, "중국 공시에 없는 구간은 만들지 않는다");
assert.equal(periodWindow(""), null);
assert.equal(periodWindow("25Q1"), null);

// 아래 환율은 2026-09-08에 유럽중앙은행 기준환율에서 받은 실제 값이다.
const payload = {
  base: "USD",
  rates: {
    "2024-12-31": { CNY: 7.2994 },
    "2025-01-02": { CNY: 7.2995 }, "2025-01-03": { CNY: 7.3183 }, "2025-01-06": { CNY: 7.3167 },
    "2025-01-07": { CNY: 7.3263 }, "2025-01-08": { CNY: 7.3316 }, "2025-01-09": { CNY: 7.3322 },
    "2025-01-10": { CNY: 7.3313 },
    "2025-05-02": { CNY: 7.2000 },
    "2025-08-01": { CNY: 7.1000 },
  },
};

const rates = averageRates(payload, ["2025Q1", "2025H1", "2025Q3", "2025"]);
const pick = (period) => rates.find((row) => row.period === period);

// 1분기 창에는 1월 7영업일만 들어간다. 전년 말(2024-12-31)은 창 밖이라 빠져야 한다.
const q1 = pick("2025Q1");
assert.equal(q1.sample_days, 7, "직전 연도 마지막 고시가 새 해 창에 섞이면 안 된다");
assert.ok(Math.abs(q1.rate_avg - (7.2995 + 7.3183 + 7.3167 + 7.3263 + 7.3316 + 7.3322 + 7.3313) / 7) < 1e-9);
assert.equal(q1.base, "USD");
assert.equal(q1.quote, "CNY");
assert.equal(q1.source, FX_SOURCE);
assert.deepEqual([q1.window_start, q1.window_end], ["2025-01-01", "2025-03-31"]);

// 누적 창이 넓어질수록 표본이 늘어난다. H1은 5월 값을, Q3은 8월 값을 더 담는다.
assert.equal(pick("2025H1").sample_days, 8, "반기 창은 5월 고시를 포함한다");
assert.equal(pick("2025Q3").sample_days, 9, "3분기 창은 8월 고시까지 포함한다");
assert.ok(pick("2025H1").rate_avg < q1.rate_avg, "5월 환율이 낮아 반기 평균이 1분기보다 낮아야 한다");

// 표본이 5일 미만이면 평균을 만들지 않는다. 시작도 안 한 분기에 값이 생기면 안 된다.
assert.equal(averageRates({ rates: { "2026-01-02": { CNY: 7.1 }, "2026-01-03": { CNY: 7.1 } } }, ["2026Q1"]).length, 0,
  "표본이 너무 적으면 평균을 만들지 않는다");
assert.deepEqual(averageRates({}, ["2025"]), []);
assert.deepEqual(averageRates({ rates: {} }, ["bad"]), []);

// 값이 0이나 음수로 오면 버린다. 환산에서 0으로 나누면 무한대가 화면에 뜬다.
assert.equal(averageRates({ rates: Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`2025-02-0${i + 1}`, { CNY: i === 0 ? 0 : 7.2 }]),
) }, ["2025Q1"])[0].sample_days, 7, "0인 고시는 표본에서 뺀다");

console.log("fx rate checks passed");
