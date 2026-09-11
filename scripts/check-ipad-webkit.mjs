import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html] = await Promise.all([
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

// iPad Chrome도 iOS WebKit을 사용한다. Array.prototype.at은 구형 WebKit에서 없으며,
// 첫 화면의 updateAsOf에서 예외가 나면 dashboard 렌더 전체가 빈 채로 끝난다.
assert.doesNotMatch(app, /\.at\s*\(/, "첫 화면과 차트에서 구형 iPad WebKit 미지원 Array.at을 쓰지 않는다");
assert.doesNotMatch(app, /\.replaceAll\s*\(/, "구형 iPad WebKit 미지원 String.replaceAll을 쓰지 않는다");
assert.doesNotMatch(html, /데이터 기준 2026\.08\.31/, "스크립트 오류 때 과거 날짜를 실제 데이터 기준처럼 표시하지 않는다");
assert.match(app, /console\.error\('dashboard load failed', error\)/, "첫 화면 렌더 오류를 콘솔에 남긴다");
assert.match(app, /showLoadFailure\('첫 화면 데이터를 표시하지 못했습니다/, "첫 화면 렌더 오류를 사용자에게 표시한다");

console.log("iPad WebKit compatibility checks passed");
