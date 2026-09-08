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
assert.match(lib, /required: \["headline_ko", "pair_lite", "trajectory", "comparison", "korea_insight"\]/);
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
assert.match(app, /비교 관계 ·/);
assert.match(app, /pair_context/);
assert.match(app, /비교 범위·판정 기준/);
assert.match(app, /반대 가설/);
assert.match(app, /const bulletText/);
assert.match(app, /report-bullets/);
assert.match(app, /split\(\/\\r\?\\n\|•\/\)/, "inline bullet separators must become separate list rows");

console.log("compare pair-lite checks passed");
