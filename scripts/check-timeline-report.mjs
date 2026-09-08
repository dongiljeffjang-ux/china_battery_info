import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timeline, api, app, html] = await Promise.all([
  readFile(new URL("../lib/timeline-report.js", import.meta.url), "utf8"),
  readFile(new URL("../api/company.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

// 지시문은 사용자가 직접 쓴 것이다. 여기서는 문장을 통째로 지키는 대신, 이 저장소의
// 불변조건과 직결되는 조항만 남아 있는지 본다.
assert.match(timeline, /투자 추천이나 기업 홍보 문서를 작성하지 않는다/, "투자 추천 금지 조항");
assert.match(timeline, /출처·원문·링크를 만들어내지 않는다/, "출처 날조 금지 조항");
assert.match(timeline, /활동이 없거나 중단되었다고 해석하지 않는다/, "결측을 중단으로 읽지 않는다");
assert.match(timeline, /계획 생산능력과 가동·생산 실적/, "계획과 실적을 가르는 조항");
assert.match(timeline, /계약·전략협력·MOU를 실제 출하·매출로 취급하지 않는다/, "계약을 실적으로 읽지 않는다");
assert.match(timeline, /발표일, 실제 사건 발생일, 통계 대상 기간을 구분한다/, "시점 구분 조항");
assert.match(timeline, /핵심 변화는 최대 3개만 선정하라/, "핵심 변화 상한");
// 화면이 Markdown을 렌더링한다. 모델이 HTML을 내면 그대로 문자열이 보인다.
assert.match(timeline, /반환 형식은 Markdown이다/, "반환 형식을 Markdown으로 못박아야 한다");
assert.match(timeline, /report_markdown_ko/, "스키마는 Markdown 한 필드다");
assert.doesNotMatch(timeline, /webSearch\s*:\s*true/);
// 입력에 없는 자료를 있다고 가정하지 않게 명시한다.
assert.match(timeline, /기존 보고서 또는 HTML: 없음/, "없는 입력은 없다고 적어야 한다");
assert.match(timeline, /이전 회차 보고서: 없음/);
assert.match(api, /mode\s*\|\|\s*""\)\s*===\s*"timeline_report"/);
assert.match(api, /cleanTimelineEvents/);
assert.match(api, /sourceUrl/);
assert.doesNotMatch(api, /result\.report\.turning_points/, "Markdown 리포트에는 이전 turning_points 구조를 읽으면 안 된다");
assert.match(timeline, /시장-실적\/생산기반/);
assert.match(timeline, /function layerTable/);
assert.match(html, /id="company-timeline-report"/);
assert.match(html, /id="company-timeline-report-panel"/);
assert.match(app, /mode:\s*'timeline_report'/);
assert.match(app, /function chooseReportSupporting/);
assert.match(app, /보조 정보를 포함할까요/);
assert.match(app, /await chooseReportSupporting\(\);/);
assert.match(app, /period:\s*periodOf\(event\.date\)/);
assert.match(app, /HTML로 저장/);
assert.match(app, /new Blob\(\[.*text\/html;charset=utf-8/s);
assert.match(app, /function renderTimelineMarkdown/);
assert.doesNotMatch(app, /<pre class="timeline-report-markdown">/, "리포트 Markdown 원문을 pre에 그대로 표시하면 안 된다");
assert.match(app, /서버 히스토리나 DB에는 저장되지 않습니다/);

console.log("timeline report checks passed");
