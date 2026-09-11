// 보고서 유보 표현: 규칙을 "판단할 수 없다"로 적어서 지키지 않게 하고, 넘치면 서버가 한 번 고쳐 쓴다. 네트워크 없이 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";
import { countHedges, hedgeSentences, reduceHedges, REPORT_PHRASING_RULE, HEDGE_LIMIT } from "../lib/report-phrasing.js";

const report = [
  "# 전략 방향: 저장전지로 무게가 옮겨 갔다",
  "> 동력전지 중심에서 저장전지 중심으로 이동했다.",
  "## 과거 대 현재",
  "실제 출하 여부는 확인되지 않아 판단할 수 없다.",
  "시장 대비 성과는 알 수 없다. 원인은 단정할 수 없다.",
  "추가 확인이 필요하다.",
  "다만 시간 순서는 제품 발표가 장착 확대를 유발했다는 인과를 증명하지 않는다.",
  "제품 발표 뒤 3개 분기 안에 장착이 늘었다.",
  "## 근거",
  "- 2025 매출 확인되지 않음(부록은 세지 않는다)",
].join("\n");
assert.equal(countHedges(report), 5, "본문의 유보 문장을 한 문장에 한 번씩 센다(인과 면책 포함, 부록 제외)");
assert.equal(countHedges("선후 관계를 인과로 단정할 수 없다."), 1, "인과 면책 문장을 잡는다");
assert.equal(countHedges("인과관계는 확인되지 않았다."), 1);
assert.equal(countHedges("제품 발표 뒤 장착이 늘었다."), 0, "인과를 주장하지 않는 서술은 잡지 않는다");
assert.equal(countHedges("이는 첨부 정책표의 연결 경로에 따른 해석이며, 개별 차종·제품의 규정 충족 여부는 제시되지 않았다."), 1, "출처 면책 문장을 잡는다");
assert.equal(countHedges("정책 원문은 독립 검증되지 않았다."), 1);
assert.equal(countHedges("## 근거\n판단할 수 없다"), 0, "근거·부록 절은 세지 않는다");
assert.equal(countHedges("출하가 확인된 사업만 본다."), 0, "긍정 서술은 세지 않는다");
assert.ok(hedgeSentences(report).some(sentence => /판단할 수 없다/.test(sentence)));
assert.ok(!hedgeSentences(report).some(sentence => /부록은 세지/.test(sentence)));

// 상한 이하면 모델을 부르지 않는다(키가 없어도 통과해야 한다).
const light = "# 제목\n본문. 원인은 단정할 수 없다.";
const kept = await reduceHedges(light);
assert.equal(kept.rewritten, false);
assert.equal(kept.markdown, light);
assert.ok(HEDGE_LIMIT >= 1);

assert.match(REPORT_PHRASING_RULE, /그 주장을 쓰지 않는 것으로 지킨다/);
assert.match(REPORT_PHRASING_RULE, /결론을 바꿀 관측을 조건으로 쓴다/);
assert.match(REPORT_PHRASING_RULE, /인과 면책 문장도 쓰지 않는다/, "시간 순서·인과 면책 문장을 금지한다(2026-09-11 사용자 요청)");
assert.match(REPORT_PHRASING_RULE, /출처·검증 면책 문장도 쓰지 않는다/, "출처·검증 면책 문장을 금지한다(2026-09-11 사용자 요청)");
const timeline = fs.readFileSync(new URL("../lib/timeline-report.js", import.meta.url), "utf8");
assert.match(timeline, /유보 문장과, .*출처 면책 문장을 쓰지 않는다/, "시계열 공통 지시문이 유보·면책 표현 규칙을 담는다");
assert.doesNotMatch(timeline, /\$\{REPORT_PHRASING_RULE\}/, "규칙을 두 번 붙이지 않는다(프롬프트 길이)");
assert.match(timeline, /Date\.now\(\) \+ HEDGE_REWRITE_MS < deadline/, "고쳐 쓰기는 함수 한도 안에서만 한다");
const compare = fs.readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
assert.match(compare, /유보 문장과 .*출처 면책 문장을 쓰지 않고 그 논점을 뺀다/, "비교 보고서 FACT_RULE이 유보·면책 표현 규칙을 담는다");
assert.doesNotMatch(compare, /\$\{REPORT_PHRASING_RULE\}/, "규칙을 두 번 붙이지 않는다(프롬프트 길이)");
const api = fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8");
assert.match(api, /const deadline = Date\.now\(\) \+ 260000/);
assert.match(api, /hedge: result\.hedge/, "유보 표현 수를 로그에 남긴다");

console.log("report phrasing checks passed");

// 모든 보고서 맨 위 핵심 요약 3~4줄(2026-09-11 사용자 지정).
const { REPORT_SUMMARY_RULE } = await import("../lib/report-phrasing.js");
assert.match(REPORT_SUMMARY_RULE, /핵심 요약을 3~4줄/);
assert.equal((timeline.match(/"## 핵심 요약",/g) || []).length, 3, "세 모드 골격 모두 제목 바로 아래 핵심 요약 절을 둔다");
assert.match(timeline, /핵심 요약은 3~4줄, 한 줄에 한 문장/, "시계열 공통 지시문이 요약 규칙을 담는다");
assert.match(compare, /summary_ko는 리포트 맨 위에 놓이는 핵심 요약이다\. \$\{REPORT_SUMMARY_RULE\}/);
assert.match(compare, /summary_ko는 종합 맨 위에 놓이는 핵심 요약이다\. \$\{REPORT_SUMMARY_RULE\}/);
const appSrc = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const renderSource = appSrc.slice(appSrc.indexOf("// 리포트 출력은 제한된 Markdown만"), appSrc.indexOf("function timelineReportParts"));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const renderTimelineMarkdown = new Function("escapeHtml", renderSource + "; return renderTimelineMarkdown;")(escapeHtml);
const html = renderTimelineMarkdown("# 전략 방향: 제목\n## 핵심 요약\n\n- 첫째 판단\n- 둘째 판단\n- 셋째 판단\n## 과거 대 현재\n본문");
assert.match(html, /<section class="summary-box"><p class="summary-title">핵심 요약<\/p><ul><li>첫째 판단<\/li><li>둘째 판단<\/li><li>셋째 판단<\/li><\/ul><\/section>/, "핵심 요약 절은 요약 상자로 그린다");
assert.match(html, /<h3>과거 대 현재<\/h3>/, "요약 뒤 절은 그대로 그린다");
console.log("report summary checks passed");
