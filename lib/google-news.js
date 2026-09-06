// Google News URL decoding protocol adapted from Ruslan Gainutdinov's
// MIT-licensed decodeGoogleNewsUrl.ts: https://gist.github.com/huksley/bc3cb046157a99cd9d1517b32f91a99e
function decodeBatchResponse(text) {
  const header = '[\\"garturlres\\",\\"';
  const startIndex = text.indexOf(header);
  if (startIndex < 0) throw new Error("GOOGLE_NEWS_DECODE_RESPONSE_INVALID");
  const remainder = text.slice(startIndex + header.length);
  const endIndex = remainder.indexOf('\\",');
  if (endIndex < 0) throw new Error("GOOGLE_NEWS_DECODE_URL_MISSING");
  return JSON.parse(`"${remainder.slice(0, endIndex)}"`);
}

async function decodeWithBatchExecute(id, timestamp, signature) {
  const articleRequest = [
    "Fbv4je",
    JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(timestamp), signature]),
  ];
  const request = JSON.stringify([[articleRequest]]);
  const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Referer: "https://news.google.com/" },
    body: new URLSearchParams({ "f.req": request }).toString(),
  });
  if (!response.ok) throw new Error(`GOOGLE_NEWS_DECODE_${response.status}`);
  return decodeBatchResponse(await response.text());
}

export async function resolveGoogleNewsUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "news.google.com" || parts.at(-2) !== "articles") return sourceUrl;

  const id = parts.at(-1);
  let bytes = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const prefix = Buffer.from([0x08, 0x13, 0x22]);
  const suffix = Buffer.from([0xd2, 0x01, 0x00]);
  if (bytes.subarray(0, prefix.length).equals(prefix)) bytes = bytes.subarray(prefix.length);
  if (bytes.length >= suffix.length && bytes.subarray(-suffix.length).equals(suffix)) bytes = bytes.subarray(0, -suffix.length);
  const firstLengthByte = bytes[0];
  const urlLength = firstLengthByte >= 0x80 ? bytes[1] : firstLengthByte;
  const offset = firstLengthByte >= 0x80 ? 2 : 1;
  const decoded = bytes.subarray(offset, offset + urlLength).toString("utf8");
  let resolved = decoded;
  if (decoded.startsWith("AU_yqL")) {
    const page = await fetch(sourceUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)" } });
    if (!page.ok) throw new Error(`GOOGLE_NEWS_PARAMS_${page.status}`);
    const html = await page.text();
    const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    if (!timestamp || !signature) throw new Error("GOOGLE_NEWS_PARAMS_MISSING");
    resolved = await decodeWithBatchExecute(id, timestamp, signature);
  }
  if (!/^https?:\/\//i.test(resolved)) throw new Error("GOOGLE_NEWS_DECODE_NON_HTTP");
  return resolved;
}
