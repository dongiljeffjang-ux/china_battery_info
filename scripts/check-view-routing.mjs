import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

// /admin의 "기업 분석" 링크는 /#companies로 전체 페이지를 다시 연다.
// 클릭 핸들러만으로는 이 경로를 처리할 수 없으므로 초기 해시와 뒤로가기 모두
// 같은 라우팅 함수를 거쳐야 한다.
assert.match(source, /function viewFromLocationHash\(hash = window\.location\.hash\)/,
  "초기 URL 해시를 유효한 화면 이름으로 해석해야 한다");
assert.match(source, /activateView\(viewFromLocationHash\(\)\);[\s\S]*await loadCompanyCatalog\(\);/,
  "카탈로그 로딩 전에 직접 링크 화면을 활성화해야 한다");
assert.match(source, /window\.addEventListener\('hashchange',\s*\(\) => activateView\(viewFromLocationHash\(\)\)\);/,
  "해시 변경과 뒤로가기에도 화면을 동기화해야 한다");

console.log("view routing checks passed");
