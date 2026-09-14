// Supabase 요청의 시간제한·재시도 규칙. 네트워크 없이 fetch를 가짜로 물려 돈다.
// 2026-09-12·13 밤 크론이 API의 짧은 504 창에서 첫 요청부터 죽은 사고를 고정한다.
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const { supabaseRest, isIdempotentRequest, RETRY_DELAYS_MS } = await import("../lib/supabase.js");

const okResponse = (body) => ({
  ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body, text: async () => JSON.stringify(body),
});
const failResponse = (status) => ({
  ok: false, status, headers: { get: () => "application/json" }, json: async () => ({}), text: async () => `{"message":"Gateway Timeout"}`,
});
const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

// 재시도 간격을 기다리지 않도록 타이머를 즉시 끝낸다.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);

async function withFetch(sequence, run) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = sequence.shift();
    if (typeof next === "function") return next(init);
    return next;
  };
  const outcome = await run();
  return { calls, outcome };
}

// 1) 멱등 판정
assert.equal(isIdempotentRequest("article?select=id", "GET"), true);
assert.equal(isIdempotentRequest("article?id=eq.1", "PATCH"), true);
assert.equal(isIdempotentRequest("ingestion_guard?owner=eq.x", "DELETE"), true);
assert.equal(isIdempotentRequest("ingestion_guard?on_conflict=key", "POST"), true, "on_conflict upsert는 두 번 보내도 같다");
assert.equal(isIdempotentRequest("rpc/admin_overview", "POST"), true, "이 저장소의 rpc는 전부 읽기다");
assert.equal(isIdempotentRequest("event", "POST"), false, "조건 없는 append는 재시도하면 행이 두 번 들어간다");
assert.equal(isIdempotentRequest("pipeline_log", "POST"), false);

// 2) 504 두 번 뒤 성공 → GET은 세 번째에 결과를 돌려준다.
{
  const { calls, outcome } = await withFetch([failResponse(504), failResponse(504), okResponse([{ id: 1 }])],
    () => supabaseRest("article?select=id"));
  assert.deepEqual(outcome, [{ id: 1 }]);
  assert.equal(calls.length, RETRY_DELAYS_MS.length + 1, "재시도 횟수는 간격 목록 길이와 같다");
  assert.ok(calls.every(({ init }) => init.signal instanceof AbortSignal), "모든 요청에 시간제한 신호가 붙는다");
}

// 3) 끝까지 504면 마지막 오류를 던지고, 상태 코드를 남긴다.
{
  const { calls, outcome } = await withFetch([failResponse(504), failResponse(503), failResponse(502)],
    () => supabaseRest("article?select=id").catch((error) => error));
  assert.equal(calls.length, 3);
  assert.equal(outcome.status, 502);
  assert.equal(outcome.code, "DB_REQUEST_FAILED");
}

// 4) 4xx는 일시 장애가 아니다. 한 번만 보내고 바로 던진다.
{
  const { calls, outcome } = await withFetch([failResponse(409), okResponse([])],
    () => supabaseRest("ingestion_guard?on_conflict=key", { method: "POST", body: { key: "collection" } }).catch((error) => error));
  assert.equal(calls.length, 1, "409·404 같은 응답은 재시도하지 않는다");
  assert.equal(outcome.status, 409);
}

// 5) 조건 없는 POST는 504여도 재시도하지 않는다(중복 삽입 방지). retry:true로 명시하면 재시도한다.
{
  const { calls, outcome } = await withFetch([failResponse(504), okResponse([])],
    () => supabaseRest("event", { method: "POST", body: { title_ko: "x" } }).catch((error) => error));
  assert.equal(calls.length, 1, "append POST는 한 번만 보낸다");
  assert.equal(outcome.status, 504);
  const forced = await withFetch([failResponse(504), okResponse([{ id: 2 }])],
    () => supabaseRest("event", { method: "POST", body: { title_ko: "x" }, retry: true }));
  assert.equal(forced.calls.length, 2);
  assert.deepEqual(forced.outcome, [{ id: 2 }]);
}

// 6) 시간제한: 응답이 없으면 신호가 끊고(TimeoutError), 그 뒤 재시도한다.
{
  // AbortSignal.timeout의 타이머는 unref라 이벤트 루프를 붙잡지 않는다. 가짜 fetch가 매달려 있는 동안
  // 프로세스가 끝나지 않도록 ref 타이머를 하나 걸어 둔다.
  const hang = (init) => new Promise((_, reject) => {
    const keepAlive = realSetTimeout(() => {}, 5000);
    init.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(init.signal.reason); });
  });
  const { calls, outcome } = await withFetch([hang, okResponse([{ id: 3 }])],
    () => supabaseRest("article?select=id", { timeoutMs: 30 }));
  assert.equal(calls.length, 2, "시간제한에 걸린 요청은 한 번 더 보낸다");
  assert.deepEqual(outcome, [{ id: 3 }]);
  assert.ok(warnings.some((line) => line.includes("[SUPABASE_RETRY]") && line.includes("TimeoutError")), "시간제한 재시도도 로그에 남는다");
}

// 7) 재시도 로그는 경로를 120자로 자른다(canonical_url in.(...) 조회가 수천 자).
assert.ok(warnings.every((line) => JSON.parse(line.replace("[SUPABASE_RETRY] ", "")).path.length <= 120));

console.log("supabase retry checks passed");
