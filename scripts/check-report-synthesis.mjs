import assert from "node:assert/strict";
import fs from "node:fs";

// 비교 리포트 함의 종합의 제품 규칙을 고정한다. 종합은 해석이므로 근거 되짚기와 금지 문구가 핵심이다.
const lib = fs.readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase/report-synthesis.sql", import.meta.url), "utf8");

const prompt = lib.match(/export const REPORT_SYNTHESIS_PROMPT =([\s\S]*?);\n/)?.[1] || "";
assert.ok(prompt.includes("웹 검색을 쓰지 않는다"), "종합은 저장된 리포트만 근거로 써야 한다");
assert.ok(prompt.includes("투자 추천은 어떤 형태로도 쓰지 않는다"), "투자 추천 금지가 프롬프트에 있어야 한다");
assert.ok(prompt.includes("한 단계까지만 추론한다"), "여러 단계 건너뛴 결론 금지가 프롬프트에 있어야 한다");
assert.ok(prompt.includes("행동 지시나 할 일 목록을 쓰지 않는다"), "행동 지시 금지가 프롬프트에 있어야 한다");

const shape = lib.slice(lib.indexOf("const SYNTHESIS_ITEM"), lib.indexOf("export const REPORT_SYNTHESIS_PROMPT"));
assert.ok(/required: \["theme_ko", "finding_ko", "basis_ko", "report_refs"\]/.test(shape), "모든 항목은 근거 문장과 리포트 번호를 가져야 한다");
const build = lib.slice(lib.indexOf("export async function buildReportSynthesis"), lib.indexOf("// ── 검증 결과를 DB에 되돌린다"));
assert.ok(!/webSearch: true/.test(build), "종합 호출은 웹 검색을 켜면 안 된다");
assert.ok(/provider: "openai"/.test(build), "종합은 OpenAI가 맡는다");

const route = api.slice(api.indexOf("async function runReportSynthesis"), api.indexOf("async function handleRequest"));
assert.ok(route.includes("ids.length < 2"), "리포트 2건 미만은 거부해야 한다");
assert.ok(route.includes("ids.length > MAX_SYNTHESIS_REPORTS"), "리포트 수 상한이 있어야 한다");
assert.ok(route.includes('=== "compare"'), "종합의 재료는 compare 행만이어야 한다(해석 위에 해석을 쌓지 않는다)");
assert.ok(route.includes('kind: "synthesis"'), "종합 결과는 synthesis 종류로 저장해야 한다");
assert.ok(api.includes("has_more"), "히스토리 목록은 더보기 페이지 정보를 내려야 한다");

assert.ok(app.includes("id=\"history-more\""), "화면에 더보기 버튼이 있어야 한다");
assert.ok(app.includes("mode: 'synthesize_reports'"), "화면이 종합 모드를 호출해야 한다");
assert.ok(app.includes("함의 종합 — 해석"), "종합 문서는 해석임을 머리에 표시해야 한다");

assert.ok(/check \(kind in \('compare', 'synthesis'\)\)/.test(sql), "kind 값은 두 가지로 제한한다");
assert.ok(/company_a_id drop not null/.test(sql), "종합 행은 회사 컬럼이 비어야 하므로 not null을 풀어야 한다");
assert.ok(!/\b(delete|truncate|drop table)\b/i.test(sql), "스키마는 기존 데이터를 지우면 안 된다");
console.log("report synthesis checks passed");
