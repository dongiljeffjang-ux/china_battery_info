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
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json", Prefer: options.prefer || "return=representation" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!result.ok) {
    const error = new Error(`Supabase request failed: ${result.status}`);
    error.code = "DB_REQUEST_FAILED";
    throw error;
  }
  const contentType = result.headers.get("content-type") || "";
  return contentType.includes("application/json") ? result.json() : null;
}
