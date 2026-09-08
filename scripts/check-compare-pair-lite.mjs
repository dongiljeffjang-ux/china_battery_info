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
assert.match(lib, /판가 요인 미분리/);
assert.match(lib, /데이터 공백/);
assert.match(lib, /PAIR_LITE_RULE/);
assert.match(lib, /JSON\.stringify\(pairContext\)/);
assert.match(app, /비교 관계 ·/);
assert.match(app, /pair_context/);

console.log("compare pair-lite checks passed");
