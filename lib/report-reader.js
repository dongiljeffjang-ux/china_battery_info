// 거래소 정기보고서(연차·반기·분기) PDF를 실제로 내려받아 텍스트를 뽑는다.
//
// 웹 검색으로 "보고서에 이렇게 적혀 있다"고 모델이 말하게 두지 않고 원문을 읽힌다.
// 그래서 출처 URL이 항상 그 보고서 자체이고, 모델이 URL을 지어낼 여지가 없다.
// 6MB·267쪽 보고서 기준 내려받기부터 발췌까지 3~4초가 걸린다.

import crypto from "node:crypto";

const UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)";
const CNINFO_QUERY = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
// 홍콩거래소. 종목코드 → 내부 stockId를 먼저 찾고, 제목 검색으로 연차(40100)·중간(40200)보고서를 받는다.
// 중문판 PDF는 글자가 추출되지 않는 경우가 있어(CALB 2025 중문판이 226쪽에 4만 자) 영문판을 읽는다.
const HKEX_PREFIX = "https://www1.hkexnews.hk/search/prefix.do";
const HKEX_SEARCH = "https://www1.hkexnews.hk/search/titleSearchServlet.do";
const HKEX_T2CODE = { annual: "40100", semiannual: "40200" };
const hkexStockIds = new Map();

// 모델에 넣을 최대 분량. 보고서 전문은 20만 자를 넘어 그대로 넣을 수 없다.
const MAX_SECTION_CHARS = 60000;
// 重要事项(중요사항) 절은 대형 계약·모집자금 프로젝트 진척처럼 MD&A에 없는 사실이 있다. 이만큼 덧붙인다.
const MAX_MATTERS_CHARS = 20000;

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

// pdfjs는 Node에서 DOMMatrix 같은 브라우저 API를 @napi-rs/canvas로 채우려 하고, 그 패키지가
// 없으면 경고만 남기고 넘어간다. 그러다 실제로 그 API를 쓰는 PDF를 만나면 "DOMMatrix is not defined"로
// 죽는다. 홍콩거래소(HKEX) 보고서가 여기 걸려 CALB·REPT 시계열이 통째로 비어 있었다.
// 우리는 글자만 뽑고 그림을 그리지 않으므로, 행렬 계산만 되는 최소 구현으로 채운다.
function installPdfDomPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        const v = Array.isArray(init) ? init : typeof init === "string" ? init.replace(/[^0-9eE.,+-]/g, "").split(",").map(Number) : null;
        const [a, b, c, d, e, f] = v && v.length >= 6 ? v : [1, 0, 0, 1, 0, 0];
        Object.assign(this, { a, b, c, d, e, f, m11: a, m12: b, m21: c, m22: d, m41: e, m42: f, is2D: true });
      }
      // 2차원 아핀 변환 곱. pdfjs가 변환 행렬을 합칠 때만 쓴다.
      multiplySelf(o) {
        const { a, b, c, d, e, f } = this;
        this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b;
        this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d;
        this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f;
        return this;
      }
      multiply(o) { return new globalThis.DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o); }
      translateSelf(tx = 0, ty = 0) { this.e += this.a * tx + this.c * ty; this.f += this.b * tx + this.d * ty; return this; }
      scaleSelf(sx = 1, sy = sx) { this.a *= sx; this.b *= sx; this.c *= sy; this.d *= sy; return this; }
      invertSelf() {
        const det = this.a * this.d - this.b * this.c;
        if (!det) { this.a = this.b = this.c = this.d = this.e = this.f = NaN; return this; }
        const { a, b, c, d, e, f } = this;
        this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det;
        this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det;
        return this;
      }
      transformPoint(p = {}) {
        const x = p.x || 0, y = p.y || 0;
        return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
      }
      toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
    };
  }
  // 그림을 그리지 않으므로 존재만 하면 된다. 없으면 같은 방식으로 ReferenceError가 난다.
  if (typeof globalThis.ImageData === "undefined") {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        if (typeof data === "number") { this.width = data; this.height = width; this.data = new Uint8ClampedArray(data * width * 4); }
        else { this.data = data; this.width = width; this.height = height ?? (data.length / 4 / width); }
      }
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} bezierCurveTo() {} quadraticCurveTo() {} };
  }
}

// pdfjs 로더.
//
// Node에는 워커가 없어 pdfjs가 "가짜 워커"를 쓰는데, 그때 pdf.worker.mjs를 동적 import 한다.
// Vercel 번들에 그 파일이 없으면 "Setting up fake worker failed: Cannot find module"로 죽는다
// (2026-09-08 운영 로그). 워커 경로를 명시해 두고, 번들러가 추적하도록 정적 경로로 참조한다.
// vercel.json의 includeFiles가 파일 자체를 함수에 포함시킨다.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // 워커 파일 위치를 직접 알려 준다. pdfjs는 이 값을 실제로 import 하므로(로컬 실험: 없는
      // 경로를 주면 운영과 같은 오류가 재현됨) 파일이 있는 경로를 골라야 한다. 번들 안 상대 경로를
      // 먼저 보고, 없으면 모듈 해석에 맡긴다. 어느 쪽을 골랐는지 로그에 남겨 운영에서 확인한다.
      const candidates = [];
      try { candidates.push(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url)); } catch {}
      try { candidates.push(new URL(import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"))); } catch {}
      const { existsSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const found = candidates.find((candidate) => { try { return existsSync(fileURLToPath(candidate)); } catch { return false; } });
      if (found) pdfjs.GlobalWorkerOptions.workerSrc = found.href;
      console.info("[PDF_WORKER]", JSON.stringify({ chosen: found ? found.href : null, tried: candidates.map((c) => c.href) }));
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(url) {
  installPdfDomPolyfills();
  const hkex = /hkexnews\.hk/.test(url);
  const response = await fetchWithRetry(url, { headers: { "User-Agent": UA, Referer: hkex ? "https://www1.hkexnews.hk/" : "https://www.cninfo.com.cn/" }, timeoutMs: hkex ? 60000 : 30000 });
  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  let text = "";
  const visualPages = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    const pdfPage = await doc.getPage(page);
    const [content, operators] = await Promise.all([pdfPage.getTextContent(), pdfPage.getOperatorList()]);
    const pageText = pageToLines(content.items);
    text += pageText + "\n";
    const view = pdfPage.view || [0, 0, 1, 1];
    const pageArea = Math.max(1, Math.abs((view[2] - view[0]) * (view[3] - view[1])));
    const hasLargeImage = operators.fnArray.some((fn, index) => {
      if (![pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(fn)) return false;
      const args = operators.argsArray[index] || [];
      const width = Number(args[1] || args[0]?.width || 0);
      const height = Number(args[2] || args[0]?.height || 0);
      return width > 0 && height > 0 && width * height >= pageArea * 0.1;
    });
    if (hasLargeImage) visualPages.push(page);
  }
  // 표 행에 단위를 붙이고 문장으로 펴는 것은 쪽을 다 모은 뒤에 한다. 표는 쪽을 넘어가도 머리는 한 번뿐이다.
  return { text: renderTableRows(annotateTableUnits(text)), pages: doc.numPages, visual_pages: visualPages,
    parse_quality: visualPages.length ? "visual_review_required" : "text_only",
    source_sha256: crypto.createHash("sha256").update(data).digest("hex") };
}

// 같은 줄에 있는 조각을 y좌표로 묶고, x 간격이 벌어진 곳을 셀 경계로 본다.
//
// 예전에는 조각을 join("")로 이어 붙여 행 구분도 셀 구분도 사라졌다. 그러면 재무표가
// "...400,917,045归属于上市公司股东的净利润 72,201,282..."처럼 앞 행 끝 숫자와 다음 행
// 항목명이 한 덩어리가 되고, 청킹이 표 한가운데를 자르면 헤더가 떨어져 나가 어느 숫자가
// 어느 해인지 알 수 없게 된다. pdfjs가 좌표를 이미 주므로 그것으로 표 모양을 되살린다.
//
// 파이프는 표로 보이는 줄에만 넣는다. 산문과 표제에 파이프가 섞이면 절 찾기(sliceDiscussion)와
// 읽기가 모두 나빠지므로, 간격이 여러 번 벌어지고 숫자가 있는 줄만 표로 본다.
const CELL_GAP_PT = 6;
export function pageToLines(items) {
  const rows = new Map();
  for (const item of items) {
    const str = String(item.str ?? "");
    if (!str.trim()) continue;
    const y = Math.round(item.transform[5]);
    // 같은 줄이라도 글자마다 y가 1~2pt 흔들린다. 가까운 줄에 합친다.
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: item.transform[4], width: item.width || str.length * 6, str });
  }
  const lines = [];
  for (const [, cells] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    cells.sort((a, b) => a.x - b.x);
    const gaps = [];
    let end = null;
    for (const cell of cells) {
      if (end !== null && cell.x - end > CELL_GAP_PT) gaps.push(true);
      end = cell.x + cell.width;
    }
    const plain = cells.map((cell) => cell.str).join("");
    // 간격이 두 번 넘게 벌어지고 숫자가 있으면 표 행으로 본다.
    if (gaps.length >= 2 && /[0-9]/.test(plain)) {
      let line = "";
      end = null;
      for (const cell of cells) {
        if (end !== null && cell.x - end > CELL_GAP_PT) line += " | ";
        line += cell.str;
        end = cell.x + cell.width;
      }
      lines.push(splitGluedCells(line.trim()));
    } else {
      // 간격이 좁아 표로 못 알아봤어도 천단위 숫자가 셋 이상 이어지면 뭉개진 표 행이다.
      lines.push(BIG_NUMBER_RUN.test(plain) ? splitGluedCells(plain.trim()) : plain.trim());
    }
  }
  return lines.filter(Boolean).join("\n");
}

// 셀 사이 간격이 6pt보다 좁으면 두 셀이 한 덩어리로 붙는다. 저장된 보고서 5건에서 줄당 43~154번
// 일어났다. 예: "全资子公司114,252.25", "525.3530,302,917.96"(소수 둘째 자리 뒤에 다음 셀),
// "528.82抵押". 중국 재무표는 금액을 항상 소수 둘째 자리까지 쓰고 천단위 쉼표를 찍으므로
// 그 모양을 경계로 삼는다. 산문에는 손대지 않는다(호출자가 표 행에만 적용한다).
const BIG_NUMBER = "[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]+)?";
const BIG_NUMBER_RUN = new RegExp(`(?:${BIG_NUMBER}\\D{0,12}){3}`);
export function splitGluedCells(line) {
  return line
    // 한자·괄호 바로 뒤에 천단위 숫자: 항목명과 금액이 붙음
    .replace(new RegExp(`([\\u4e00-\\u9fff）)])(?=${BIG_NUMBER})`, "g"), "$1 | ")
    // 소수 둘째 자리 바로 뒤에 다음 셀의 숫자나 한자: 금액과 금액, 금액과 항목명이 붙음.
    // 단, "451,404.49万元"처럼 숫자에 단위가 이어진 것은 한 셀이므로 단위 글자 앞에서는 가르지 않는다.
    .replace(/(\d\.\d{2})(?=[0-9]{1,3},[0-9]{3}|(?![万亿千百元港欧美股吨人个倍次])[一-鿿])/g, "$1 | ")
    .replace(/ \| \| /g, " | ");
}

// 표의 금액 단위는 표 머리 "单位：万元"에만 적혀 있어, 모델이 행만 보면 단위를 추측한다.
// 2026-09-07 Farasis 반기보고서 보증 표에서 万元을 千元로 읽어 5건이 10배 작게 저장됐다.
// 단위 표기를 만나면 그 뒤의 표 행마다 "[单位:万元]"을 붙여 단위가 행에 같이 다니게 한다.
// 다음 단위 표기나 절 제목(第N节)에서 끊는다. 지우는 것은 없고 덧붙이기만 한다.
// 표 행을 자기 완결 문장으로 편다. 한 쪽에는 표와 줄글이 섞여 있으므로 두 갈래로 다룬다 —
// 표는 행 단위로, 표 밖의 줄글은 문단 단위로. 행마다 표 이름과 열 이름을 붙여
//   "担保情况 · 孚能镇江: 关系 全资子公司, 担保金额 114,252.25, 发生日期 2023/3/22 (单位:万元)"
// 처럼 만들면, 그 한 줄만 보고도 어느 값이 어느 열·어느 단위인지 알 수 있다. 헤더가 청크 밖으로
// 밀려나거나 모델이 행만 인용해도 값의 뜻이 살아남는다. 열 수가 헤더와 맞지 않는 행(병합 셀·소제목)은
// 손대지 않고 파이프 그대로 둔다. 헤더 행 자체도 남겨 둔다.
const TABLE_CELL_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?%?$|^-$|^\/$/;
// 헤더 행에는 금액·날짜가 없다. 실제 보고서에서는 여러 줄로 감싼 헤더가 y좌표 묶기에 산산이
// 흩어져 파이프 행으로 남지 않고, 첫 파이프 행이 데이터 행("公司 | 公司本部 | 孚能镇江 |
// 230,000.00 | 2021/10/15 …")인 경우가 흔하다. 그것을 헤더로 잘못 잡으면 뒤 행이 전부 엉뚱한
// 문장이 되므로, 천단위 금액·소수·날짜가 한 셀이라도 있으면 헤더로 보지 않는다.
const DATA_LIKE_CELL = /\d{1,3}(,\d{3})+|\d+\.\d+|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/;
export function renderTableRows(text) {
  const lines = text.split("\n");
  const out = [];
  let title = null;      // 표 바로 위의 짧은 줄글(표 이름 후보)
  let header = null;     // 현재 표의 열 이름
  for (const line of lines) {
    const isRow = line.includes(" | ");
    if (!isRow) {
      header = null;
      const bare = line.replace(UNIT_MARK, "").replace(/币种[：:]\s*\S+/, "").trim();
      title = bare && bare.length <= 40 && !/[。；;]/.test(bare) ? bare.replace(/^[一二三四五六七八九十\d]+[、.)]\s*/, "") : null;
      out.push(line);
      continue;
    }
    const unitTag = /\s*\[单位:([^\]]+)\]\s*$/.exec(line);
    const body = unitTag ? line.slice(0, unitTag.index) : line;
    const cells = body.split(" | ").map((cell) => cell.trim());
    if (header === false) { out.push(line); continue; }
    if (!header) {
      // 표의 첫 행. 숫자 셀이 절반 미만이고 금액·날짜 셀이 하나도 없어야 헤더로 본다.
      // 헤더가 없다고 판단되면 이 표는 파이프 그대로 둔다(단위 주석은 이미 붙어 있다).
      const numeric = cells.filter((cell) => TABLE_CELL_NUMBER.test(cell)).length;
      const dataLike = cells.some((cell) => DATA_LIKE_CELL.test(cell));
      if (cells.length >= 2 && numeric < cells.length / 2 && !dataLike) { header = cells; out.push(line); continue; }
      header = false; // 이 블록은 헤더 없음. 다음 줄글이 나올 때까지 행을 문장으로 펴지 않는다.
      out.push(line);
      continue;
    }
    if (cells.length < header.length - 1 || cells.length > header.length + 1 || cells.length < 2) { out.push(line); continue; }
    const name = cells[0];
    const pairs = cells.slice(1).map((value, index) => `${header[index + 1] ?? `열${index + 2}`} ${value}`);
    out.push(`${title ? `${title} · ` : ""}${name}: ${pairs.join(", ")}${unitTag ? ` (单位:${unitTag[1]})` : ""}`);
  }
  return out.join("\n");
}

const UNIT_MARK = /单位[：:]\s*(人民币)?\s*(元|千元|万元|百万元|亿元)/;
const SECTION_HEAD = /^第[一二三四五六七八九十]+节/;
export function annotateTableUnits(text) {
  let unit = null;
  return text.split("\n").map((line) => {
    const mark = UNIT_MARK.exec(line);
    if (mark) { unit = mark[2]; return line; }
    if (SECTION_HEAD.test(line)) { unit = null; return line; }
    if (unit && line.includes(" | ") && /[0-9]/.test(line) && !line.includes("[单位:")) return `${line} [单位:${unit}]`;
    return line;
  }).join("\n");
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
  // 간체 보고서는 목차·감사보고서·과학기술윤리 항목에도 같은 표제가 나온다. 뒤에 경영 분석 본문 표지가
  // 곧 따라오는 위치가 진짜 절이다. (fetch-coverage 스크립트에서 먼저 잡았던 오류를 여기에도 적용)
  const bodyLike = (index) => /经营情况讨论与分析|主营业务分析|报告期内，公司实现|报告期内公司实现|一、经营情况|一、报告期内公司所处/.test(text.slice(index, index + 3000));
  const start = (english ? deep.find((index) => upperRatio(index) < 0.35) ?? deep[0] : (deep.find(bodyLike) ?? deep.pop())) ?? 0;
  const enders = (english
    ? ["CORPORATE GOVERNANCE REPORT", "Corporate Governance Report", "REPORT OF THE DIRECTORS", "DIRECTORS AND SENIOR MANAGEMENT", "BIOGRAPHICAL DETAILS"]
    : ["公司治理、环境和社会", "第四节", "重要事项"])
    .map((mark) => text.indexOf(mark, start + 500))
    .filter((index) => index > start);
  const end = enders.length ? Math.min(...enders) : text.length;
  return text.slice(start, Math.min(end, start + maxChars)).replace(/[ \t]{2,}/g, " ").trim();
}

// 重要事项 절: 목차에도 표제가 있으므로, 뒤에 본문이 충분하고 그 절다운 낱말(诉讼·承诺·合同)이 곧 나오는 위치를 고른다.
export function sliceMajorMatters(text, maxChars = MAX_MATTERS_CHARS) {
  if (text.includes("MANAGEMENT DISCUSSION AND ANALYSIS")) return "";
  const marks = [];
  for (let index = text.indexOf("重要事项"); index >= 0; index = text.indexOf("重要事项", index + 1)) marks.push(index);
  const start = marks.filter((index) => text.length - index > 15000 && /诉讼|承诺|合同|担保/.test(text.slice(index, index + 1500))).pop();
  if (start === undefined) return "";
  const enders = ["股份变动及股东情况", "股份变动", "优先股相关情况", "债券相关情况"]
    .map((mark) => text.indexOf(mark, start + 2000))
    .filter((index) => index > start);
  const end = enders.length ? Math.min(...enders) : text.length;
  // 承诺事项(약정 이행)이 절 머리를 차지하므로, 사실이 있는 募集资金(모집자금 프로젝트)과 重大合同(대형 계약)부터 담는다.
  const pieces = [];
  for (const mark of ["募集资金", "重大合同"]) {
    const at = text.indexOf(mark, start);
    if (at > start && at < end) pieces.push(text.slice(at, Math.min(end, at + Math.floor(maxChars / 2))));
  }
  const body = pieces.length ? pieces.join("\n…\n") : text.slice(start, Math.min(end, start + maxChars));
  return body.replace(/[ \t]{2,}/g, " ").trim();
}

export async function readReport(company, { kind = "annual", knownUrl = null } = {}) {
  const found = knownUrl
    ? { url: knownUrl, title: REPORT_KINDS[kind]?.label_ko || null, published_at: null, kind }
    : await findReport(company, kind);
  if (!found) throw new Error("REPORT_NOT_FOUND");
  const { text, pages, visual_pages, parse_quality, source_sha256 } = await extractPdfText(found.url);
  const discussion = sliceDiscussion(text);
  if (discussion.length < 1000) throw new Error("REPORT_TEXT_TOO_SHORT");
  const matters = sliceMajorMatters(text);
  const section = matters ? `${discussion}\n\n--- 重要事项 ---\n${matters}` : discussion;
  // text(전문)까지 돌려준다. 거래소에 공개된 자료라 보관할 수 있고, 나중에 다시 내려받지 않아도 된다.
  return { ...found, pages, section, text, totalChars: text.length, visual_pages, parse_quality, source_sha256 };
}
