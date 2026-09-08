import assert from "node:assert/strict";
import fs from "node:fs";

// Vercel은 배포가 자기 자신을 이어 부르는 체인을 5번째 내부 호출에서 508로 끊는다.
// 훅은 한 호출 안에서 이어 돌리고, 호출을 넘길 때만 깊이를 하나 쓰며, 깊이 4를 넘기지 않아야 한다.
const ingest = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");

assert.ok(/const MAX_CHAIN_DEPTH = 4;/.test(ingest), "chain depth cap must stay at 4 (5th self-call is refused with 508)");
const chain = ingest.slice(ingest.indexOf("async function chainStage"), ingest.indexOf("async function runProcessStage"));
assert.ok(chain.includes("depth > MAX_CHAIN_DEPTH"), "chainStage must refuse to exceed the depth cap");
assert.ok(chain.includes("&chain=${depth}"), "chainStage must pass the depth to the next call");

const processStage = ingest.slice(ingest.indexOf("async function runProcessStage"), ingest.indexOf("async function runProcessHop"));
assert.ok(processStage.includes("INVOCATION_BUDGET_MS"), "process hops must loop inside one invocation");
assert.ok(/const MAX_PROCESS_HOPS = 2;/.test(ingest), "deep process must stop after two hops so Daily and curate stay below the chain-depth cap");
const curateStage = ingest.slice(ingest.indexOf("async function runCurateStage"), ingest.indexOf("async function runCurateHop"));
assert.ok(curateStage.includes("INVOCATION_BUDGET_MS"), "curate hops must loop inside one invocation");
assert.ok(curateStage.includes('chainStage(request, "curate", hop + 1)'), "curate must hand off remaining hops to one more invocation");

// 훅 하나 안에서 자신을 다시 부르는 옛 패턴이 돌아오면 안 된다.
const processHop = ingest.slice(ingest.indexOf("async function runProcessHop"), ingest.indexOf("async function runDailyStage"));
assert.ok(!processHop.includes("chainStage("), "a single process hop must not chain by itself");
const curateHop = ingest.slice(ingest.indexOf("async function runCurateHop"), ingest.indexOf("async function runManualCurateStep"));
assert.ok(!curateHop.includes("chainStage("), "a single curate hop must not chain by itself");
console.log("chain depth regression checks passed");
