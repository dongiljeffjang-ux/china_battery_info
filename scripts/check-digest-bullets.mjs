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
assert.ok(src.includes('<ul class="matrix-details">${detailPoints.map(point => `<li>${escapeHtml(clipText(point, 64))}</li>`).join(\'\')}</ul>'),
  "시계열 표 제목 아래에도 핵심 내용이 불릿으로 보여야 한다");
assert.match(src, /const detailPoints = splitSentences\(factWithoutTitle\([\s\S]{0,260}?\)\)[\s\S]{0,180}?\.slice\(0, 1\)/,
  "시계열 표는 제목 중복을 제거하고 가장 중요한 한 문장만 짧게 보여야 한다");
assert.ok(!src.includes('<span class="digest-detail">'), "옛 한 덩어리 설명 span은 남으면 안 된다");
assert.ok(/traj-detail-item[\s\S]{0,600}factWithoutTitle\(/.test(src), "궤적 상세 카드도 같은 규칙을 써야 한다");
const css = fs.readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
assert.ok(css.includes(".digest-points{"), "불릿 목록 스타일이 있어야 한다");
assert.ok(css.includes('.matrix-details li::before{content:"-"'), "시계열 상세에는 요청한 하이픈 말머리가 있어야 한다");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
assert.match(html, /app\.js\?v=20260911-unified-timeline/, "캐시 버전을 올려야 배포 뒤 옛 app.js가 남지 않는다");
// 보조 데이터(사용자 지정 2026-09-10): 칸에는 제목만, 요약·수치는 툴팁. 리포트에는 툴팁 내용이 그대로 간다.
assert.match(src, /const detail = isPrimaryEvidence\(event\) && detailPoints\.length/, "보조 데이터는 시계열 칸에 요약 줄을 그리지 않는다");
assert.match(src, /const metrics = isPrimaryEvidence\(event\) \? keyMetrics\(event\) : ''/, "보조 데이터는 비교 칸에 수치 줄을 그리지 않는다");
assert.match(src, /const compareReportEvent = event => \(\{[\s\S]{0,200}?fact: event\.fact, entity: entityLabel\(event\), sourceName/, "비교 리포트에 사실 전문·발생 법인·출처를 보낸다");
assert.match(src, /fact: event\.fact, entity: entityLabel\(event\), sourceName: event\.sourceName, sourceUrl/, "시계열 리포트에 사실 전문·발생 법인·출처를 보낸다");
// 툴팁 출처 줄에는 기사 발행일만 붙이고 긴 주소는 넣지 않는다(사용자 지정 2026-09-10). 링크는 칸의 '원문'.
assert.match(src, /function sourceTipText\(event\)\{\n  return `출처: \$\{event\.sourceName\}\$\{event\.sourceDate \? ` · 발행 \$\{event\.sourceDate\}` : ''\}`;\n\}/, "툴팁 출처 줄에는 발행일만 있고 주소는 없어야 한다");
// 시계열 리포트의 긴 주소는 'link'로 줄여 새 창에서 연다.
const inlineStart = src.indexOf("function inlineMarkdown(text){");
const inlineEnd = src.indexOf("function renderTimelineMarkdown(markdown){");
const escapeStart = src.indexOf("function escapeHtml(");
assert.ok(inlineStart > 0 && inlineEnd > inlineStart && escapeStart >= 0, "inlineMarkdown·escapeHtml이 있어야 한다");
const escapeSrc = src.slice(escapeStart, src.indexOf("\n}", escapeStart) + 2);
const inlineMarkdown = new Function(`${escapeSrc}\n${src.slice(inlineStart, inlineEnd)}; return inlineMarkdown;`)();
const rendered = inlineMarkdown("출처: 界面新闻, https://www.jiemian.com/article/1.html?a=1&b=2. 그리고 [원문](https://example.com/x) · [https://example.com/y](https://example.com/y) **굵게**");
assert.ok(!/>https?:\/\//.test(rendered) && !/https?:\/\/[^"]*<\//.test(rendered), "화면에 긴 주소 글자가 남으면 안 된다");
assert.equal((rendered.match(/>link<\/a>/g) || []).length, 2, "맨 주소와 주소 라벨 링크는 'link'로 줄인다");
assert.match(rendered, /href="https:\/\/www\.jiemian\.com\/article\/1\.html\?a=1&amp;b=2" target="_blank" rel="noreferrer">link<\/a>\./, "끝의 마침표는 주소에서 뺀다");
assert.match(rendered, />원문<\/a>/, "글자 라벨 링크는 라벨을 유지한다");
assert.match(rendered, /<strong>굵게<\/strong>/);
assert.equal(inlineMarkdown("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;", "모델 문자열은 이스케이프한다");
assert.ok(fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8").includes("article(canonical_url,source_name,source_tier,published_at)"), "기사 발행일을 함께 읽어야 한다");
// Daily Sankey 기본 기간: 월요일은 직전 금요일을 포함해 당일~3일 전, 그 외 요일은 당일~2일 전.
assert.match(src, /=== 'Mon' \? -3 : -2;/, "Sankey 기본 기간은 월요일만 당일~3일 전이어야 한다");
assert.match(src, /const chainOrder = \{ cell: 0, cathode: 1, anode: 2 \};/, "Sankey 회사는 셀·양극재·음극재 순으로 묶어야 한다");
assert.match(src, /const compareByFlowCount = \(x, y\) => flowCount\(y\) - flowCount\(x\)/, "같은 밸류체인 안의 Sankey 회사는 신호 건수 내림차순이어야 한다");
assert.match(src, /const quantitativeRecords = \[\n    \.\.\.\(timeline\.financials \|\| \[\]\)/, "Excel 정량 정보 시트는 API 거래소 재무 원본을 모두 담아야 한다");
assert.match(src, /\.\.\.\(timeline\.metrics \|\| \[\]\)\.map/, "Excel 정량 정보 시트는 API 보고서 발췌 원본도 모두 담아야 한다");
assert.ok(src.includes("XLSX.utils.book_append_sheet(workbook, financialSheet, '정량 정보');"), "Excel 내보내기에 정량 정보 시트가 있어야 한다");

console.log("ok  digest-bullets");
