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
assert.match(lib, /required: \["headline_ko", "pair_lite", "trajectory", "comparison", "korea_insight", "policy_analysis_ko"\]/);
assert.match(lib, /pair_lite\.scope_ko/);
assert.match(lib, /upstream 공급 신호/);
assert.match(lib, /downstream 수요 신호/);
assert.match(lib, /제한적 해석은 허용/);
assert.match(lib, /문단형 줄글은 금지/);
assert.match(lib, /'• '/);
assert.match(lib, /판가 요인 미분리/);
assert.match(lib, /데이터 공백/);
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
assert.match(app, /pair_context/);
assert.match(app, /핵심 비교 논점/);
assert.match(app, /판단이 달라지는 지점/);
assert.match(app, /한국 산업에 주는 의미/);
assert.match(app, /const bulletText/);
assert.match(app, /report-bullets/);
assert.match(app, /split\(\/\\r\?\\n\|•\/\)/, "inline bullet separators must become separate list rows");

console.log("compare pair-lite checks passed");
