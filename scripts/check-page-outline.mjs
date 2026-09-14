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
// 캐시 버전은 여기 한 곳에서만 본다. 값을 세 스크립트에 나눠 적었더니 버전을 올릴 때마다 빠뜨린
// 스크립트가 생겼다(2026-09-14 커밋 df8f8b3 이후 검사 2개가 깨진 채 남았다). 값이 아니라 형식을 본다.
assert.match(html, /app\.js\?v=\d{8}-[a-z0-9-]+/, "app.js는 날짜-이름 형식의 캐시 버전을 달고 있어야 한다");
assert.match(html, /styles\.css\?v=\d{8}-[a-z0-9-]+/, "styles.css도 같은 형식의 캐시 버전을 달고 있어야 한다");

console.log("page outline checks passed");
