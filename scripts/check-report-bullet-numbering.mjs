import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const escapeStart = source.indexOf("function escapeHtml(");
const escapeEnd = source.indexOf("\n}", escapeStart) + 2;
const bulletStart = source.indexOf("  const bulletText = value => {");
const bulletEnd = source.indexOf("  // 1단계:", bulletStart);
assert.ok(escapeStart >= 0 && bulletStart >= 0 && bulletEnd > bulletStart, "비교 보고서의 bulletText 렌더러가 있어야 한다");

const bulletText = new Function(`${source.slice(escapeStart, escapeEnd)}\n${source.slice(bulletStart, bulletEnd)}; return bulletText;`)();
const html = bulletText("1. 첫 번째 의미\n2. 두 번째 의미\n3. 세 번째 의미");
assert.match(html, /<ol class="report-bullets">/, "번호 목록은 하나의 순서 목록으로 렌더링해야 한다");
assert.doesNotMatch(html, />1\. 첫 번째 의미</, "목록 항목 안에 반복 번호를 남기면 안 된다");
assert.doesNotMatch(html, />2\. 두 번째 의미</, "원문 번호는 브라우저 목록 번호와 중복되면 안 된다");
assert.match(html, />첫 번째 의미</);
assert.match(html, />두 번째 의미</);

console.log("report bullet numbering checks passed");
