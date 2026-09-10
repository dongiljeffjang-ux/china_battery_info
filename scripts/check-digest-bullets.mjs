// 연차보고서 핵심 사실 카드의 설명 형식. 네트워크·API 호출 없음.
//
// 2026-09-09 사용자 요청: 설명이 제목을 그대로 되풀이하며 시작하면("보고기간 투자액" /
// "보고기간 투자액은 3,223억…") 그 앞머리를 떼고, 남은 내용은 문장 단위 불릿으로 보여 준다.
// app.js는 브라우저 스크립트라 import할 수 없어, 도우미 구간만 잘라 평가하고 나머지는 소스를 대조한다.
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("const TITLE_PARTICLE");
const end = src.indexOf("function digestItemParts");
assert.ok(start > 0 && end > start, "factWithoutTitle 도우미가 있어야 한다");
const factWithoutTitle = new Function(`${src.slice(start, end)}; return factWithoutTitle;`)();

// 제목 + 조사로 시작하는 설명은 그 앞머리를 뗀다.
assert.equal(
  factWithoutTitle("보고기간 투자액", "보고기간 투자액은 32,232,460천 위안으로 전년 동기 대비 39.66% 증가했다."),
  "32,232,460천 위안으로 전년 동기 대비 39.66% 증가했다.",
);
assert.equal(factWithoutTitle("연구개발비", "연구개발비: 6.31억 위안"), "6.31억 위안", "콜론 구분도 뗀다");
// 회사 주어를 뗀 제목과 원제목 둘 다 시도한다. 설명은 회사명을 포함한 채로 시작할 수 있다.
assert.equal(factWithoutTitle("상반기 매출", "닝더스다이(CATL) 상반기 매출은 2,769억 위안이다.", "닝더스다이(CATL) 상반기 매출"), "2,769억 위안이다.");
// 설명이 제목과 같으면 아무것도 남기지 않는다(제목만 보여준다).
assert.equal(factWithoutTitle("연간 영업수익", "연간 영업수익"), "");
// 제목으로 시작하지 않는 설명은 그대로 둔다. 겹친 낱말이 있어도 앞머리가 아니면 자르지 않는다.
assert.equal(factWithoutTitle("2025년 매출 4,237억 위안", "2025년 영업수입은 4,237억 위안이다."), "2025년 영업수입은 4,237억 위안이다.");
// 정규식 특수문자가 든 제목도 안전하다.
assert.equal(factWithoutTitle("특허(발명) 등록", "특허(발명) 등록은 3건이다."), "3건이다.");

// 보고서 카드와 시계열 표가 불릿 목록으로 그린다. 도우미만 있고 안 쓰면 아무것도 바뀌지 않는다.
assert.ok(src.includes('<ul class="digest-points">${points.map(point => `<li>${escapeHtml(point)}</li>`).join(\'\')}</ul>'), "핵심 사실 카드가 불릿으로 그려야 한다");
assert.ok(src.includes('<ul class="matrix-details">${detailPoints.map(point => `<li>${escapeHtml(clipText(point, 120))}</li>`).join(\'\')}</ul>'),
  "시계열 표 제목 아래에도 핵심 내용이 불릿으로 보여야 한다");
assert.match(src, /const detailPoints = splitSentences\(factWithoutTitle\([\s\S]{0,180}?\)\)\.slice\(0, 2\)/,
  "시계열 표는 제목 중복을 제거하고 핵심 문장을 두 개까지만 보여야 한다");
assert.ok(!src.includes('<span class="digest-detail">'), "옛 한 덩어리 설명 span은 남으면 안 된다");
assert.ok(/traj-detail-item[\s\S]{0,600}factWithoutTitle\(/.test(src), "궤적 상세 카드도 같은 규칙을 써야 한다");
const css = fs.readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
assert.ok(css.includes(".digest-points{"), "불릿 목록 스타일이 있어야 한다");
assert.ok(css.includes('.matrix-details li::before{content:"-"'), "시계열 상세에는 요청한 하이픈 말머리가 있어야 한다");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
assert.match(html, /app\.js\?v=20260910-policy-axis/, "캐시 버전을 올려야 배포 뒤 옛 app.js가 남지 않는다");

console.log("ok  digest-bullets");
