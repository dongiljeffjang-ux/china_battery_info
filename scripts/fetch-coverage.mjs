// 추적 상장사의 최근 3년 정기보고서(연차·반기)를 받아 사실 밀도가 높은 구간만 텍스트로 남긴다.
// LLM을 호출하지 않는다. 뽑은 텍스트는 에이전트가 직접 읽고 이벤트로 정리해 DB에 넣는다.
//
//   node scripts/fetch-coverage.mjs [--only catl,byd] [--kinds semiannual,annual]
//
// 결과: outputs/coverage/<company>/<kind>-<fiscal>.txt (원문 발췌), .condensed.txt (수치 문장만), index.json

import fs from "node:fs";
import path from "node:path";
import { COMPANIES } from "../lib/china-sources.js";
import { findReports, extractPdfText, sliceDiscussion, sliceMajorMatters } from "../lib/report-reader.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const ONLY = argOf("--only", "").split(",").map((v) => v.trim()).filter(Boolean);
const KINDS = argOf("--kinds", "semiannual,annual").split(",").map((v) => v.trim()).filter(Boolean);
const FISCALS = argOf("--fiscal", "").split(",").map((v) => Number(v.trim())).filter(Boolean);
const FORCE = args.includes("--force");
const OUT_DIR = path.join("outputs", "coverage");
const COVERAGE_YEARS = 3;

// 회계연도별 발행 창. lib/curation.js의 coverageWindows와 같은 규칙이다.
function coverageWindows(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const windows = [];
  for (let back = 0; back <= COVERAGE_YEARS; back += 1) {
    const fiscal = year - back;
    if (back < COVERAGE_YEARS && (back > 0 || month >= 8)) windows.push({ kind: "semiannual", fiscal, from: `${fiscal}-07-01`, to: `${fiscal}-11-30` });
    if (back > 0) windows.push({ kind: "annual", fiscal, from: `${fiscal + 1}-01-01`, to: `${fiscal + 1}-07-31` });
  }
  return windows.filter((w) => KINDS.includes(w.kind) && (!FISCALS.length || FISCALS.includes(w.fiscal))).sort((a, b) => b.from.localeCompare(a.from));
}

const SECTIONS = [
  { mark: "管理层讨论与分析", chars: 24000, minTail: 15000 },
  { mark: "主要控股参股公司分析", chars: 3000, minTail: 1500 },
  { mark: "主要会计数据和财务指标", chars: 2500, minTail: 1500 },
];
// 같은 제목이 목차·감사보고서에도 나온다. 경영 실적 서술("主营业务分析" 또는 "报告期内，公司实现")이
// 뒤따르는 위치를 본문으로 본다. 없으면 예전처럼 꼬리가 충분히 긴 마지막 위치를 쓴다.
function sliceAt(text, mark, chars, minTail) {
  const marks = [];
  for (let i = text.indexOf(mark); i >= 0; i = text.indexOf(mark, i + 1)) marks.push(i);
  const body = marks.find((i) => {
    const ahead = text.slice(i, i + chars);
    return /主营业务分析|报告期内，公司实现|报告期内公司实现/.test(ahead) && text.length - i > minTail;
  });
  const start = body ?? marks.filter((i) => text.length - i > minTail).pop();
  if (start === undefined) return "";
  return text.slice(start, start + chars).replace(/\s{2,}/g, " ").trim();
}

const FACT = /(万吨|吨|GWh|MWh|Ah|亿元|万元|亿美元|万平方米|条产线|产能|产量|出货|销量|销售量|营业收入|净利润|毛利率|产能利用率|投产|开工|竣工|达产|量产|中标|定点|供货|订单|客户|认证|专利|募投|投资额|新增|扩建|收购|控股|参股|海外|出口|工厂|基地|市占率|市场份额|排名|第一|首个|首次|发布|推出)/;
const NUM = /\d/;
const FORECAST = /(预计|拟|将于|有望|力争|目标|愿景|致力于|不断|持续推进|积极|努力)/;
const NOISE = /(本报告|详见|请参见|不适用|单位：|币种|注[0-9]|第[一二三四五六七八九十]+节|目录|√|□)/;
function condense(body) {
  const kept = [];
  const seen = new Set();
  for (const chunk of body.split(/[。；\n]/)) {
    const line = chunk.replace(/\s+/g, " ").trim();
    if (line.length < 12 || line.length > 300) continue;
    if (!NUM.test(line) || !FACT.test(line)) continue;
    if (FORECAST.test(line) || NOISE.test(line)) continue;
    const key = line.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}

const targets = COMPANIES.filter((c) => (c.cninfo || c.hkex) && (!ONLY.length || ONLY.includes(c.id)));
const windows = coverageWindows();
console.log(`대상 ${targets.length}개사 × 창 ${windows.length}개: ${windows.map((w) => `${w.kind}-${w.fiscal}`).join(", ")}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const index = fs.existsSync(path.join(OUT_DIR, "index.json")) ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, "index.json"), "utf8")) : [];
const done = new Set(FORCE ? [] : index.filter((r) => !r.error).map((r) => `${r.id}|${r.kind}|${r.fiscal}`));

for (const [i, company] of targets.entries()) {
  const label = `${String(i + 1).padStart(2)}/${targets.length} ${company.id}`;
  const dir = path.join(OUT_DIR, company.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const kind of KINDS) {
    let reports = [];
    try { reports = await findReports(company, kind, { years: COVERAGE_YEARS + 1.7 }); }
    catch (error) { console.log(`${label.padEnd(28)} ${kind} 목록 실패: ${error.message}`); continue; }
    for (const window of windows.filter((w) => w.kind === kind)) {
      const key = `${company.id}|${kind}|${window.fiscal}`;
      if (done.has(key)) continue;
      const found = reports.find((r) => r.published_at >= window.from && r.published_at <= window.to);
      const tag = `${kind}-${window.fiscal}`;
      if (!found) { console.log(`${label.padEnd(28)} ${tag} 없음`); index.push({ id: company.id, kind, fiscal: window.fiscal, error: "REPORT_NOT_FOUND" }); continue; }
      try {
        const { text, pages } = await extractPdfText(found.url);
        // MD&A는 lib의 자르기(목차·감사보고서·과학기술윤리 항목을 건너뛰는 규칙, 영문판 지원)를 쓰고,
        // 나머지 두 구간은 기존 방식. 간체 보고서는 重要事项(모집자금·대형계약)을 덧붙인다.
        const english = text.includes("MANAGEMENT DISCUSSION AND ANALYSIS");
        const parts = [`### 管理层讨论与分析\n${sliceDiscussion(text, english ? 60000 : 40000)}`]
          .concat(english ? [] : SECTIONS.slice(1).map((s) => { const body = sliceAt(text, s.mark, s.chars, s.minTail); return body ? `### ${s.mark}\n${body}` : ""; }))
          .filter(Boolean);
        if (!english) { const matters = sliceMajorMatters(text); if (matters) parts.push(`### 重要事项(募集资金·重大合同)\n${matters}`); }
        if (!parts.length) { console.log(`${label.padEnd(28)} ${tag} 구간 추출 실패 (${pages}쪽)`); index.push({ id: company.id, kind, fiscal: window.fiscal, url: found.url, error: "NO_SECTION" }); continue; }
        const header = `# ${company.name_ko} (${company.name_zh})\n보고서: ${found.title}\n종류: ${kind} · 회계연도 ${window.fiscal}\n공시일: ${found.published_at}\nURL: ${found.url}\n쪽수: ${pages}`;
        const raw = `${header}\n\n${parts.join("\n\n")}\n`;
        const lines = condense(parts.join("\n"));
        fs.writeFileSync(path.join(dir, `${tag}.txt`), raw, "utf8");
        fs.writeFileSync(path.join(dir, `${tag}.condensed.txt`), `${header}\n\n${lines.map((l) => `- ${l}。`).join("\n")}\n`, "utf8");
        console.log(`${label.padEnd(28)} ${tag} ${String(pages).padStart(3)}쪽 · 발췌 ${raw.length.toLocaleString()}자 · 수치문장 ${lines.length} · ${found.published_at}`);
        const at = index.findIndex((r) => r.id === company.id && r.kind === kind && r.fiscal === window.fiscal);
        const entry = { id: company.id, name_ko: company.name_ko, kind, fiscal: window.fiscal, url: found.url, title: found.title, published_at: found.published_at, pages, chars: raw.length, lines: lines.length };
        if (at >= 0) index[at] = entry; else index.push(entry);
      } catch (error) {
        console.log(`${label.padEnd(28)} ${tag} 실패: ${error.message}`);
        index.push({ id: company.id, kind, fiscal: window.fiscal, url: found.url, error: error.message });
      }
      fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");
    }
  }
}
const ok = index.filter((r) => !r.error);
console.log(`\n성공 ${ok.length} / 시도 ${index.length} → ${OUT_DIR}`);
