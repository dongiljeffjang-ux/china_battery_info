import { isAccessAllowed, issueAccessCookie, validateAccessKey } from "../lib/access.js";

export default async function handler(request, response) {
  if (request.method === "GET") return response.status(isAccessAllowed(request) ? 200 : 401).json({ status: isAccessAllowed(request) ? "authorized" : "access_required" });
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!process.env.APP_ACCESS_KEY) return response.status(503).json({ status: "access_key_not_configured" });
  if (!validateAccessKey(request.body?.accessKey)) return response.status(401).json({ status: "invalid_access_key" });
  issueAccessCookie(response);
  return response.status(200).json({ status: "authorized" });
}
