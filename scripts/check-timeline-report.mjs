import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timeline, api, app, html] = await Promise.all([
  readFile(new URL("../lib/timeline-report.js", import.meta.url), "utf8"),
  readFile(new URL("../api/company.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

assert.match(timeline, /웹 검색, 일반 지식, 입력에 없는 수치·고객·계획을 쓰지 않는다/);
assert.match(timeline, /투자 추천·행동 지시는 어떤 형태로도 쓰지 않는다/);
assert.doesNotMatch(timeline, /webSearch\s*:\s*true/);
assert.match(api, /mode\s*\|\|\s*""\)\s*===\s*"timeline_report"/);
assert.match(api, /cleanTimelineEvents/);
assert.match(timeline, /basis_event_ids[\s\S]*filter\(id => ids\.has\(id\)\)/);
assert.match(html, /id="company-timeline-report"/);
assert.match(html, /id="company-timeline-report-panel"/);
assert.match(app, /mode:\s*'timeline_report'/);
assert.match(app, /HTML로 저장/);
assert.match(app, /new Blob\(\[.*text\/html;charset=utf-8/s);
assert.match(app, /서버 히스토리나 DB에는 저장되지 않습니다/);

console.log("timeline report checks passed");
