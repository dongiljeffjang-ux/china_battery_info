// 추적 회사의 최신 연차보고서를 받아 핵심 구간만 텍스트로 남긴다.
// LLM을 호출하지 않는다. 뽑은 텍스트는 사람이(또는 에이전트가) 직접 읽고 정리한다.
//
//   node scripts/fetch-reports.mjs [--only catl,byd]

import fs from "node:fs";
import path from "node:path";
import { COMPANIES } from "../lib/china-sources.js";
import { findReport, extractPdfText } from "../lib/report-reader.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const ONLY = argOf("--only", "").split(",").map((v) => v.trim()).filter(Boolean);
const OUT_DIR = path.join("outputs", "reports");

// 사실 밀도가 높은 구간만 남긴다. 보고서 전문은 20만 자를 넘는다.
const SECTIONS = [
  { mark: "管理层讨论与分析", chars: 22000, minTail: 20000 },
  { mark: "主要控股参股公司分析", chars: 3000, minTail: 1500 },
  { mark: "主要会计数据和财务指标", chars: 2500, minTail: 1500 },
];

function sliceAt(text, mark, chars, minTail) {
  const marks = [];
  for (let i = text.indexOf(mark); i >= 0; i = text.indexOf(mark, i + 1)) marks.push(i);
  const start = marks.filter((i) => text.length - i > minTail).pop();
  if (start === undefined) return "";
  return text.slice(start, start + chars).replace(/\s{2,}/g, " ").trim();
}

const targets = COMPANIES.filter((c) => c.cninfo && (!ONLY.length || ONLY.includes(c.id)));
const skipped = COMPANIES.filter((c) => !c.cninfo).map((c) => c.id);
console.log(`대상 ${targets.length}개사 · 공시 설정 없어 제외 ${skipped.length}곳: ${skipped.join(", ")}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const index = [];
for (const [i, company] of targets.entries()) {
  const label = `${String(i + 1).padStart(2)}/${targets.length} ${company.id}`;
  try {
    const found = await findReport(company, "annual");
    if (!found) { console.log(`${label.padEnd(30)} 보고서 없음`); index.push({ id: company.id, error: "REPORT_NOT_FOUND" }); continue; }
    const { text, pages } = await extractPdfText(found.url);
    const parts = SECTIONS.map((s) => { const body = sliceAt(text, s.mark, s.chars, s.minTail); return body ? `### ${s.mark}\n${body}` : ""; }).filter(Boolean);
    if (!parts.length) { console.log(`${label.padEnd(30)} 구간 추출 실패 (${pages}쪽)`); index.push({ id: company.id, error: "NO_SECTION" }); continue; }
    const body = `# ${company.name_ko} (${company.name_zh})\n보고서: ${found.title}\n공시일: ${found.published_at}\nURL: ${found.url}\n쪽수: ${pages}\n\n${parts.join("\n\n")}\n`;
    fs.writeFileSync(path.join(OUT_DIR, `${company.id}.txt`), body, "utf8");
    console.log(`${label.padEnd(30)} ${pages}쪽 · ${body.length.toLocaleString()}자 · ${found.published_at}`);
    index.push({ id: company.id, name_ko: company.name_ko, url: found.url, title: found.title, published_at: found.published_at, pages, chars: body.length });
  } catch (error) {
    console.log(`${label.padEnd(30)} 실패: ${error.message}`);
    index.push({ id: company.id, error: error.message });
  }
}
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");
const ok = index.filter((r) => !r.error);
console.log(`\n성공 ${ok.length} / ${targets.length} · 총 ${ok.reduce((n, r) => n + r.chars, 0).toLocaleString()}자 → ${OUT_DIR}`);
if (index.some((r) => r.error)) console.log("실패:", index.filter((r) => r.error).map((r) => `${r.id}(${r.error})`).join(", "));
