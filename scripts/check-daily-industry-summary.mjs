import assert from "node:assert/strict";
import fs from "node:fs";

const generator = fs.readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const categories = generator.match(/const SUMMARY_CATEGORIES = \[(.*?)\];/s)?.[1] || "";

assert.ok(!categories.includes("산업 총평"), "산업 총평은 회사별 사실 sections에 포함되면 안 된다");
assert.ok(generator.includes("## 산업 총평"), "종합 해석 headline은 산업 총평으로 직렬화해야 한다");
assert.ok(app.includes("산업 총평과 한국 기업 관점"), "화면은 종합 해석 영역의 역할을 명시해야 한다");

console.log("daily industry summary separation checks passed");
