import crypto from "node:crypto";

const COOKIE_NAME = "cbl_access";
const SESSION_VALUE = "china-battery-lens-v1";

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  return cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function signature(key) {
  return crypto.createHmac("sha256", key).update(SESSION_VALUE).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isAccessAllowed(request) {
  const key = process.env.APP_ACCESS_KEY;
  return Boolean(key && equal(cookieValue(request, COOKIE_NAME), signature(key)));
}

export function requireAccess(request, response) {
  if (isAccessAllowed(request)) return true;
  response.status(401).json({ status: "access_required" });
  return false;
}

export function issueAccessCookie(response) {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) throw new Error("APP_ACCESS_KEY_NOT_CONFIGURED");
  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${signature(key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}

export function validateAccessKey(candidate) {
  return equal(String(candidate || ""), process.env.APP_ACCESS_KEY || "");
}
