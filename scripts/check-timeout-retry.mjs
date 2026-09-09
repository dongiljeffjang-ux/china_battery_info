import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTimeoutError, retryOnceOnTimeout } from "../lib/timeout-retry.js";

const daily = readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
const ingest = readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
assert.match(daily, /DAILY_LLM_TIMEOUT_MS = 90000/);
assert.match(daily, /timeoutMs: DAILY_LLM_TIMEOUT_MS/);
assert.match(ingest, /retryOnceOnTimeout\(\s*\(\) => generateDailyReport\(\),\s*\{ delayMs: 1500 \}/s);

assert.equal(isTimeoutError({ name: "TimeoutError" }), true);
assert.equal(isTimeoutError({ name: "AbortError" }), true);
assert.equal(isTimeoutError({ name: "TypeError" }), false);

let calls = 0;
let paused = 0;
const recovered = await retryOnceOnTimeout(async ({ attempt }) => {
  calls += 1;
  if (attempt === 1) throw Object.assign(new Error("late"), { name: "TimeoutError" });
  return "published";
}, { delayMs: 7, sleep: async (ms) => { paused = ms; } });
assert.equal(recovered, "published");
assert.equal(calls, 2);
assert.equal(paused, 7);

calls = 0;
await assert.rejects(
  retryOnceOnTimeout(async () => { calls += 1; throw Object.assign(new Error("bad request"), { name: "TypeError" }); }, { sleep: async () => {} }),
  /bad request/
);
assert.equal(calls, 1);
console.log("timeout retry regression checks passed");
