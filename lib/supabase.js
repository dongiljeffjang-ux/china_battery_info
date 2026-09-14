const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasDatabaseConfig() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

// 2026-09-12·13 밤 크론이 첫 DB 요청(잠금 upsert·회사 조회)에서 504를 받고 통째로 죽었다. Supabase 로그를
// 보면 같은 순간 날아간 서로 무관한 작은 요청 4~5개가 함께 504였고, 5,200건이 오간 시간대에는 0건이었다.
// 부하나 느린 질의가 아니라 API가 수십 초 답하지 않는 창이 간헐적으로 생기는 것이다. 그 창을 넘기는
// 재시도와, 응답이 영영 오지 않을 때 함수 예산을 다 태우지 않게 하는 시간제한을 둔다.
export const REQUEST_TIMEOUT_MS = 20000;
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000]);
const TRANSIENT_STATUS = new Set([502, 503, 504]);

// 같은 요청을 두 번 보내도 결과가 같은 경우에만 재시도한다. 조건 없는 POST(event·pipeline_log 등 append)는
// 첫 요청이 커밋된 뒤 응답만 끊겼을 때 재시도하면 행이 두 번 들어가므로 기본으로는 재시도하지 않는다.
export function isIdempotentRequest(path, method) {
  if (method !== "POST") return true;
  if (path.startsWith("rpc/")) return true;
  return /[?&]on_conflict=/.test(path);
}

function isTransient(error) {
  if (TRANSIENT_STATUS.has(error?.status)) return true;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return true;
  return error instanceof TypeError; // fetch의 네트워크 실패
}

async function requestOnce(path, method, options, authHeaders) {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      ...authHeaders,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json", Prefer: options.prefer || "return=representation" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || REQUEST_TIMEOUT_MS),
  });
  if (!result.ok) {
    // PostgREST는 실패 이유를 본문에 담아 준다(스키마 캐시에 테이블 없음, 제약 위반 등).
    // 상태 코드만 남기면 "failed: 404"만 보여 어디가 막혔는지 찾을 수 없다.
    const detail = await result.text().catch(() => "");
    const error = new Error(`Supabase request failed: ${result.status}${detail ? ` ${detail.slice(0, 300)}` : ""}`);
    error.code = "DB_REQUEST_FAILED";
    error.status = result.status;
    throw error;
  }
  const contentType = result.headers.get("content-type") || "";
  return contentType.includes("application/json") ? result.json() : null;
}

export async function supabaseRest(path, options = {}) {
  if (!hasDatabaseConfig()) {
    const error = new Error("Database is not configured");
    error.code = "DB_NOT_CONFIGURED";
    throw error;
  }
  // New sb_secret_* keys are opaque API keys, not JWTs. Supabase accepts them
  // in `apikey` only; legacy service_role JWTs require Authorization as well.
  const authHeaders = SERVICE_ROLE_KEY.startsWith("sb_secret_")
    ? { apikey: SERVICE_ROLE_KEY }
    : { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
  const method = options.method || "GET";
  const retry = options.retry ?? isIdempotentRequest(path, method);
  const attempts = retry ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 2]));
    try {
      return await requestOnce(path, method, options, authHeaders);
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) throw error;
      console.warn("[SUPABASE_RETRY]", JSON.stringify({ method, path: path.slice(0, 120), attempt, status: error.status || error.name }));
    }
  }
  throw lastError;
}
