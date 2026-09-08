import assert from "node:assert/strict";
import fs from "node:fs";

const generator = fs.readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const categories = generator.match(/const SUMMARY_CATEGORIES = \[(.*?)\];/s)?.[1] || "";

assert.ok(!categories.includes("산업 총평"), "산업 총평은 회사별 사실 sections에 포함되면 안 된다");
assert.ok(generator.includes("## 산업 총평"), "종합 해석 headline은 산업 총평으로 직렬화해야 한다");
assert.ok(generator.includes("한국 소재사 insight"), "생성 프롬프트와 저장 형식은 한국 소재사 insight를 명시해야 한다");
assert.ok(app.includes("해석 · 산업 총평"), "산업 총평은 Daily 본문 안에서 사실 목록 앞에 표시해야 한다");
assert.ok(app.includes("KOREAN MATERIALS INSIGHT"), "한국 소재사 insight는 별도 묶음으로 표시해야 한다");

console.log("daily industry summary separation checks passed");
