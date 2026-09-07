import assert from "node:assert/strict";
import fs from "node:fs";

// 훅 하나가 함수 호출 한도(Fluid Hobby 300초) 안에 들도록 상한들의 관계를 고정한다.
const source = fs.readFileSync(new URL("../lib/headline-knowledge.js", import.meta.url), "utf8");
const titles = Number(source.match(/const TITLES_PER_CALL = (\d+);/)?.[1]);
const calls = Number(source.match(/const CALLS_PER_HOP = (\d+);/)?.[1]);

assert.ok(titles > 0 && titles <= 30, "headline translation batch must stay within one hop budget (~50s for 30 titles)");
assert.equal(calls, 1, "headline translation must make at most one LLM call per hop");

const ingest = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
const curateBudget = Number(ingest.match(/const CURATE_BUDGET_MS = (\d+);/)?.[1]);
const invocationBudget = Number(ingest.match(/const INVOCATION_BUDGET_MS = (\d+);/)?.[1]);
const maxDuration = Number(ingest.match(/export const config = \{ maxDuration: (\d+) \};/)?.[1]);
assert.equal(maxDuration, 300, "ingest function must declare maxDuration with the `config` export that api/*.js functions honour");
assert.ok(curateBudget > 0 && invocationBudget > 0, "curation budgets must be defined");
// 마지막 훅이 예산을 꽉 채우고 로그·잔량 확인(약 20초)까지 더해도 한도 안에 들어야 한다.
assert.ok(invocationBudget + curateBudget + 20000 <= maxDuration * 1000, "invocation loop + last hop + overhead must fit in maxDuration");

const curation = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");
const reportTimeout = Number(curation.match(/const REPORT_LLM_TIMEOUT_MS = (\d+);/)?.[1]);
assert.ok(reportTimeout > 0 && reportTimeout < curateBudget, "report LLM timeout must fit inside one curation hop");
console.log("headline hop budget regression checks passed");
