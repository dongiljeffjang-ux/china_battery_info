import assert from "node:assert/strict";
import fs from "node:fs";

const generator = fs.readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const categories = generator.match(/const SUMMARY_CATEGORIES = \[(.*?)\];/s)?.[1] || "";

assert.ok(!categories.includes("산업 총평"), "산업 총평은 회사별 사실 sections에 포함되면 안 된다");
assert.ok(generator.includes("## 산업 총평"), "종합 해석 headline은 산업 총평으로 직렬화해야 한다");
assert.ok(generator.includes("한국 소재사 insight"), "생성 프롬프트와 저장 형식은 한국 소재사 insight를 명시해야 한다");
// 총평·사실·한국 소재사 관점은 한 리포트 지면의 번호 붙은 세 부분이다(2026-09-11 사용자 요청).
// 사실과 해석은 부분마다 표지로 가른다.
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
assert.ok(app.indexOf("part-overview") < app.indexOf("part-facts"), "산업 총평은 사실 목록 앞에 둔다");
assert.match(app, /dailyPartHead\('산업 총평', 'interp'/, "산업 총평은 해석 표지를 단다");
assert.match(app, /dailyPartHead\('오늘의 사실', 'fact'/, "사실 부분은 사실 표지를 단다");
assert.match(app, /dailyPartHead\('한국 소재사 관점', 'interp'/, "한국 소재사 관점은 해석 표지를 단다");
assert.match(html, /<div id="daily-summary-list" class="summary-list"><\/div>\s*<div id="daily-insight"/, "한국 소재사 관점은 같은 리포트 지면 안에 둔다");
assert.doesNotMatch(html, /<section id="daily-insight"/, "한국 소재사 관점을 별도 섹션으로 떼지 않는다");

console.log("daily industry summary separation checks passed");
