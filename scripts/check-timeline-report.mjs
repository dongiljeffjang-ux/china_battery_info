import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timeline, api, app, html] = await Promise.all([
  readFile(new URL("../lib/timeline-report.js", import.meta.url), "utf8"),
  readFile(new URL("../api/company.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

assert.match(timeline, /전환점·인과 경로·선행지표/);
assert.match(timeline, /stock vs flow 구분/);
assert.match(timeline, /기간 정규화/);
assert.match(timeline, /결측\(—\) 처리/);
assert.match(timeline, /상관 ≠ 인과/);
assert.match(timeline, /## 7\. 데이터 공백/);
assert.doesNotMatch(timeline, /webSearch\s*:\s*true/);
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
