// 거래소 정기보고서(연차·반기·분기) PDF를 실제로 내려받아 텍스트를 뽑는다.
//
// 웹 검색으로 "보고서에 이렇게 적혀 있다"고 모델이 말하게 두지 않고 원문을 읽힌다.
// 그래서 출처 URL이 항상 그 보고서 자체이고, 모델이 URL을 지어낼 여지가 없다.
// 6MB·267쪽 보고서 기준 내려받기부터 발췌까지 3~4초가 걸린다.

const UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)";
const CNINFO_QUERY = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
// 홍콩거래소. 종목코드 → 내부 stockId를 먼저 찾고, 제목 검색으로 연차(40100)·중간(40200)보고서를 받는다.
// 중문판 PDF는 글자가 추출되지 않는 경우가 있어(CALB 2025 중문판이 226쪽에 4만 자) 영문판을 읽는다.
const HKEX_PREFIX = "https://www1.hkexnews.hk/search/prefix.do";
const HKEX_SEARCH = "https://www1.hkexnews.hk/search/titleSearchServlet.do";
const HKEX_T2CODE = { annual: "40100", semiannual: "40200" };
const hkexStockIds = new Map();

// 모델에 넣을 최대 분량. 보고서 전문은 20만 자를 넘어 그대로 넣을 수 없다.
const MAX_SECTION_CHARS = 40000;

export const REPORT_KINDS = {
  annual: { label_ko: "연차보고서", categories: ["category_ndbg_szsh"], titleRe: /年度报告/, years: 2 },
  semiannual: { label_ko: "반기보고서", categories: ["category_bndbg_szsh"], titleRe: /半年度报告/, years: 1 },
  quarterly: { label_ko: "분기보고서", categories: ["category_yjdbg_szsh", "category_sjdbg_szsh"], titleRe: /季度报告/, years: 1 },
};

const EXCLUDE_TITLE = /摘要|英文|说明会|问询|回复|补充|更正|意见|专项/;

function dateRange(years) {
  const end = new Date();
  const start = new Date(end.getTime() - years * 365 * 86400000);
  const format = (value) => value.toISOString().slice(0, 10);
  return `${format(start)}~${format(end)}`;
}

// cninfo는 간헐적으로 연결이 끊긴다. 60초 함수 안에서 짧게 재시도한다.
async function fetchWithRetry(url, options = {}, tries = 3) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 20000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// 기간 안의 정기보고서를 최신순으로 모두 돌려준다. 최근 3년 커버리지를 채우려면 해마다 한 건씩 골라야 한다.
async function hkexStockId(code) {
  if (hkexStockIds.has(code)) return hkexStockIds.get(code);
  const response = await fetchWithRetry(`${HKEX_PREFIX}?callback=callback&lang=EN&type=A&name=${encodeURIComponent(code)}&market=SEHK`, { headers: { "User-Agent": UA } });
  const body = await response.text();
  const hits = [...body.matchAll(/"stockId":(\d+),"code":"(\d+)"/g)];
  const hit = hits.find((item) => item[2] === code);
  const id = hit ? hit[1] : null;
  hkexStockIds.set(code, id);
  return id;
}

async function findHkexReports(company, kind, years) {
  const t2code = HKEX_T2CODE[kind];
  if (!t2code) return [];
  const stockId = await hkexStockId(company.hkex.code);
  if (!stockId) return [];
  const stamp = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");
  const now = new Date();
  const from = new Date(now.getTime() - years * 365 * 86400000);
  const params = new URLSearchParams({
    sortDir: "0", sortByOptions: "DateTime", category: "0", market: "SEHK", stockId, documentType: "-1",
    fromDate: stamp(from), toDate: stamp(now), title: "", searchType: "1", t1code: "40000", t2Gcode: "-2", t2code, rowRange: "100", lang: "EN",
  });
  const response = await fetchWithRetry(`${HKEX_SEARCH}?${params}`, { headers: { "User-Agent": UA } });
  const payload = await response.json();
  let rows = [];
  try { rows = JSON.parse(payload.result || "[]"); } catch { rows = []; }
  return rows
    .filter((row) => String(row.FILE_TYPE || "").toUpperCase() === "PDF" && row.FILE_LINK && /report/i.test(row.TITLE || ""))
    .map((row) => {
      const [d, m, y] = String(row.DATE_TIME || "").slice(0, 10).split("/");
      return { url: `https://www1.hkexnews.hk${row.FILE_LINK}`, title: String(row.TITLE).trim(), published_at: `${y}-${m}-${d}`, kind };
    });
}

export async function findReports(company, kind = "annual", { years } = {}) {
  const spec = REPORT_KINDS[kind];
  if (!spec) return [];
  if (company.hkex && !company.cninfo) return findHkexReports(company, kind, years || spec.years);
  if (!company.cninfo) return [];
  const span = years || spec.years;
  const codes = company.cninfo.codes || [];
  const found = [];
  for (const category of spec.categories) {
    const params = new URLSearchParams({
      pageNum: "1", pageSize: "30", tabName: "fulltext", column: company.cninfo.column, stock: "",
      searchkey: company.cninfo.query, secid: "", plate: "", category, trade: "",
      seDate: dateRange(span), sortName: "", sortType: "", isHLtitle: "false",
    });
    let payload;
    try {
      const response = await fetchWithRetry(CNINFO_QUERY, {
        method: "POST",
        headers: { "User-Agent": UA, Referer: "https://www.cninfo.com.cn/", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        body: params,
      });
      payload = await response.json();
    } catch {
      continue;
    }
    for (const item of payload.announcements || []) {
      const title = String(item.announcementTitle || "").replace(/<[^>]+>/g, "").trim();
      if (codes.length && !codes.includes(String(item.secCode))) continue;
      if (!spec.titleRe.test(title) || EXCLUDE_TITLE.test(title)) continue;
      if (!item.adjunctUrl) continue;
      found.push({ url: `https://static.cninfo.com.cn/${item.adjunctUrl}`, title, published_at: new Date(item.announcementTime).toISOString().slice(0, 10), kind });
    }
  }
  const unique = new Map();
  for (const item of found.sort((a, b) => b.published_at.localeCompare(a.published_at))) if (!unique.has(item.url)) unique.set(item.url, item);
  return [...unique.values()];
}

export async function findReport(company, kind = "annual") {
  return (await findReports(company, kind))[0] || null;
}

export async function extractPdfText(url) {
  const hkex = /hkexnews\.hk/.test(url);
  const response = await fetchWithRetry(url, { headers: { "User-Agent": UA, Referer: hkex ? "https://www1.hkexnews.hk/" : "https://www.cninfo.com.cn/" }, timeoutMs: hkex ? 60000 : 30000 });
  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  let text = "";
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    text += content.items.map((item) => item.str).join("") + "\n";
  }
  return { text, pages: doc.numPages };
}

// 사실 밀도가 가장 높은 '관리층 논의와 분석'을 잘라낸다.
// 목차에도 같은 문구가 나오므로, 뒤에 본문이 충분히 남는 마지막 등장 위치를 고른다.
export function sliceDiscussion(text, maxChars = MAX_SECTION_CHARS) {
  // 심천·상해 보고서는 간체 표제, 홍콩 영문판은 대문자 표제를 쓴다. 목차에도 같은 문구가 있으므로
  // 뒤에 본문이 충분히 남는 등장 위치 가운데 마지막(간체) 또는 첫 본문(영문)을 고른다.
  const english = text.includes("MANAGEMENT DISCUSSION AND ANALYSIS");
  const heading = english ? "MANAGEMENT DISCUSSION AND ANALYSIS" : "管理层讨论与分析";
  const marks = [];
  for (let index = text.indexOf(heading); index >= 0; index = text.indexOf(heading, index + 1)) marks.push(index);
  const deep = marks.filter((index) => text.length - index > 20000);
  // 영문판 목차는 대문자 표제와 쪽번호만 이어진다. 뒤따르는 글이 대문자 위주면 목차로 보고 건너뛴다.
  const upperRatio = (index) => { const sample = text.slice(index + 40, index + 800).replace(/[^A-Za-z]/g, ""); return sample ? (sample.replace(/[^A-Z]/g, "").length / sample.length) : 1; };
  const start = (english ? deep.find((index) => upperRatio(index) < 0.35) ?? deep[0] : deep.pop()) ?? 0;
  const enders = (english
    ? ["CORPORATE GOVERNANCE REPORT", "Corporate Governance Report", "REPORT OF THE DIRECTORS", "DIRECTORS AND SENIOR MANAGEMENT", "BIOGRAPHICAL DETAILS"]
    : ["公司治理、环境和社会", "第四节", "重要事项"])
    .map((mark) => text.indexOf(mark, start + 500))
    .filter((index) => index > start);
  const end = enders.length ? Math.min(...enders) : text.length;
  return text.slice(start, Math.min(end, start + maxChars)).replace(/\s{2,}/g, " ").trim();
}

export async function readReport(company, { kind = "annual", knownUrl = null } = {}) {
  const found = knownUrl
    ? { url: knownUrl, title: REPORT_KINDS[kind]?.label_ko || null, published_at: null, kind }
    : await findReport(company, kind);
  if (!found) throw new Error("REPORT_NOT_FOUND");
  const { text, pages } = await extractPdfText(found.url);
  const section = sliceDiscussion(text);
  if (section.length < 1000) throw new Error("REPORT_TEXT_TOO_SHORT");
  return { ...found, pages, section, totalChars: text.length };
}
