import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");

assert.match(html, /id="page-outline"[\s\S]*id="page-outline-links"/, "페이지 목차 컨테이너가 있어야 한다");
for (const label of ["오늘의 리포트", "회사별 뉴스", "근거 검색", "기업 선택", "정량·보고서", "시장·기술 시간축", "비교 기업 선택", "비교 시간축"]) {
  assert.ok(html.includes(`data-outline-label="${label}"`), `목차 항목이 빠졌다: ${label}`);
}
assert.match(app, /function refreshPageOutline\(view\)/, "열린 페이지의 목차를 다시 만드는 함수가 있어야 한다");
assert.match(app, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/, "목차 클릭은 부드럽게 해당 구간으로 이동해야 한다");
assert.match(app, /new IntersectionObserver\(/, "현재 구간을 스크롤 위치에 맞춰 표시해야 한다");
assert.match(app, /activateView[\s\S]*refreshPageOutline\(view\)/, "페이지 전환 때 목차도 바뀌어야 한다");
assert.ok(css.includes(".page-outline{"), "고정 목차 스타일이 있어야 한다");
assert.ok(css.includes("@media(max-width:760px){.page-outline{display:none}"), "모바일에서는 목차를 숨겨야 한다");
assert.match(html, /app\.js\?v=20260911-sankey-filter/, "새 목차 스크립트를 받도록 캐시 버전을 올려야 한다");

console.log("page outline checks passed");
