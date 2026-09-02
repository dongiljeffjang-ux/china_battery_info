// 거래소 정기보고서(연차·반기·분기) PDF를 실제로 내려받아 텍스트를 뽑는다.
//
// 웹 검색으로 "보고서에 이렇게 적혀 있다"고 모델이 말하게 두지 않고 원문을 읽힌다.
// 그래서 출처 URL이 항상 그 보고서 자체이고, 모델이 URL을 지어낼 여지가 없다.
// 6MB·267쪽 보고서 기준 내려받기부터 발췌까지 3~4초가 걸린다.

const UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)";
const CNINFO_QUERY = "https://www.cninfo.com.cn/new/hisAnnouncement/query";

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

export async function findReport(company, kind = "annual") {
  const spec = REPORT_KINDS[kind];
  if (!spec || !company.cninfo) return null;
  const codes = company.cninfo.codes || [];
  const found = [];
  for (const category of spec.categories) {
    const params = new URLSearchParams({
      pageNum: "1", pageSize: "30", tabName: "fulltext", column: company.cninfo.column, stock: "",
      searchkey: company.cninfo.query, secid: "", plate: "", category, trade: "",
      seDate: dateRange(spec.years), sortName: "", sortType: "", isHLtitle: "false",
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
  return found.sort((a, b) => b.published_at.localeCompare(a.published_at))[0] || null;
}

export async function extractPdfText(url) {
  const response = await fetchWithRetry(url, { headers: { "User-Agent": UA, Referer: "https://www.cninfo.com.cn/" }, timeoutMs: 30000 });
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
  const marks = [];
  for (let index = text.indexOf("管理层讨论与分析"); index >= 0; index = text.indexOf("管理层讨论与分析", index + 1)) marks.push(index);
  const start = marks.filter((index) => text.length - index > 20000).pop() ?? 0;
  const enders = ["公司治理、环境和社会", "第四节", "重要事项"]
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
