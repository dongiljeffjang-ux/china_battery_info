import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [api, lib, app] = await Promise.all([
  readFile(new URL("../api/company.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/compare-report.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
]);

assert.match(api, /function pairContext/);
assert.match(api, /pair_context: pairContextValue/);
assert.match(lib, /const PAIR_LITE_RULE/);
assert.match(lib, /const COMPARISON_MODE_RULE/);
assert.match(lib, /customer_supply/);
assert.match(lib, /실제 거래 근거가 없으면 공급 중·고객사라고 쓰지 말고/);
assert.match(api, /analysis_mode: analysisMode/);
assert.match(api, /경쟁 관점/);
assert.match(api, /고객·공급 관점/);
assert.match(lib, /required: \["summary_ko", "headline_ko", "pair_lite", "trajectory", "comparison", "korea_insight", "policy_analysis_ko"\]/, "비교 리포트는 맨 위 핵심 요약을 필수로 받는다");
assert.match(lib, /required: \["title_ko", "summary_ko", "headline_ko"/, "함의 종합도 맨 위 핵심 요약을 필수로 받는다");
assert.match(app, /\$\{reportSummaryBox\(r\.summary_ko\)\}/, "비교 리포트 맨 위에 요약 상자를 그린다");
assert.match(app, /\$\{reportSummaryBox\(s\.summary_ko\)\}/, "함의 종합 맨 위에 요약 상자를 그린다");
assert.match(lib, /pair_lite\.scope_ko/);
assert.match(lib, /upstream 공급 신호/);
assert.match(lib, /downstream 수요 신호/);
assert.match(lib, /근거가 없어 판단할 수 없는 논점은 쓰지 않는다/, "판단 불가 논점은 빼는 것이 규칙(2026-09-11 사용자 지정)");
assert.match(lib, /data_gaps_ko는 .*불확실성을 적는 유일한 칸/, "불확실성은 한 칸에만 모은다");
assert.doesNotMatch(lib, /판정 불가 사유|해당 축에서 확인된 사실이 없습니다/, "판정 불가를 쓰라는 옛 조항은 남기지 않는다");
assert.match(lib, /문단형 줄글은 금지/);
assert.match(lib, /'• '/);
assert.match(lib, /물량·판가를 분리할 근거가 있을 때만/);
assert.match(lib, /korea_insight는 이 리포트의 takeaway다/);
assert.match(lib, /PAIR_LITE_RULE/);
assert.match(lib, /JSON\.stringify\(pairContext\)/);
assert.match(lib, /import \{ metricTable, metricTableCells, metricLabel, selectTimelineEvidence \} from "\.\/timeline-report\.js"/);
assert.match(lib, /function serializeMetrics/);
assert.match(lib, /metricsA = \[\], metricsB = \[\]/);
assert.match(lib, /정량 시계열 표에 적힌 사실만 근거/);
assert.match(api, /includePolicy \? loadPolicyEvents\(\) : Promise\.resolve\(\[\]\)/, "사용자가 선택한 경우에만 비교 리포트가 정책 근거를 읽어야 한다");
assert.match(api, /eventsA, eventsB, metricsA, metricsB, alternativesA, alternativesB, policies, policyLinksA: linksA\.links, policyLinksB: linksB\.links, policyStatus, pairContext: pairContextValue/, "비교 리포트에 정량 시계열을 넘겨야 한다");
assert.match(lib, /selectTimelineEvidence\(events, \{ limit: 18, perBucket: 1 \}\)/, "비교 리포트는 회사별 대표 이벤트 18건만 모델에 보낸다");
assert.match(lib, /compareLinkedPolicyTable\(policyLinksA, policyLinksB, policies, nameA, nameB\)/, "비교 리포트는 회사별로 연결 판정된 정책만 넣는다");
assert.match(app, /비교 관계 ·/);
assert.match(app, /const CELL_LIMIT = 6;/, "비교 시간축 셀은 6건까지 보인다(2026-09-11 사용자 지정)");
assert.match(app, /pair_context/);
assert.match(app, /핵심 비교 논점/);
assert.match(app, /판단이 달라지는 지점/);
assert.match(app, /한국 산업에 주는 의미/);
assert.match(app, /const bulletText/);
assert.match(app, /report-bullets/);
assert.match(app, /split\(\/\\r\?\\n\|•\/\)/, "inline bullet separators must become separate list rows");

console.log("compare pair-lite checks passed");
