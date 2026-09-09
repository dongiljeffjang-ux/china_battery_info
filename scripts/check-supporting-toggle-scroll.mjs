import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(source, /async function refreshSupportingViews\(anchor\)/, "토글 전후 화면 위치를 보존하는 갱신 함수가 있어야 한다");
assert.match(source, /window\.scrollBy\(0, anchor\.getBoundingClientRect\(\)\.top - topBefore\)/, "토글의 화면상 위치 차이만큼 스크롤을 복원해야 한다");
assert.match(source, /await refreshSupportingViews\(box\)/, "보조 데이터 토글이 위치 보존 갱신 경로를 써야 한다");

console.log("supporting toggle scroll preservation checks passed");
