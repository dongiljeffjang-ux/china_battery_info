const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasDatabaseConfig() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
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
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      ...authHeaders,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json", Prefer: options.prefer || "return=representation" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!result.ok) {
    const detail = (await result.text()).slice(0, 500);
    console.error(`[DEBUG-sb403] Supabase ${result.status}: ${detail}`);
    const error = new Error(`Supabase request failed: ${result.status}`);
    error.code = "DB_REQUEST_FAILED";
    throw error;
  }
  const contentType = result.headers.get("content-type") || "";
  return contentType.includes("application/json") ? result.json() : null;
}
