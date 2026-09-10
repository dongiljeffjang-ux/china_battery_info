import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(source, /async function refreshSupportingViews\(anchor\)/, "토글 전후 화면 위치를 보존하는 갱신 함수가 있어야 한다");
assert.match(source, /window\.scrollBy\(0, anchor\.getBoundingClientRect\(\)\.top - topBefore\)/, "토글의 화면상 위치 차이만큼 스크롤을 복원해야 한다");
assert.match(source, /await refreshSupportingViews\(box\)/, "보조 데이터 토글이 위치 보존 갱신 경로를 써야 한다");
assert.match(source, /timeline\.events\.filter\(isPrimaryEvidence\)/, "기본 시간축 표는 시장·기술 모두 공시·핵심 근거만 표시해야 한다");
assert.doesNotMatch(source, /isPrimaryEvidence\(event\) \|\| event\.track === 'tech'/, "기술 뉴스만 보조 데이터에서 기본 근거로 승격하면 안 된다");
assert.match(source, /class="traj-lane-labels"/, "연차보고서 그래프 아래에는 시장·기술 레인 이름을 항상 표시해야 한다");
assert.match(source, />시장<\/text>[\s\S]*>기술<\/text>/, "그래프 사건 플래그의 시장·기술 두 축을 유지해야 한다");
assert.match(source, /clipText\(point, 90\)/, "표의 세부 개조식은 읽기 쉽게 축약해야 한다");

console.log("supporting toggle scroll preservation checks passed");
