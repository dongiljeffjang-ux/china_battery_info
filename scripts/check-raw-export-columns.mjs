import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app/app.js", import.meta.url), "utf8");

// Raw data 파일은 브라우저의 SheetJS로 만든다. 숫자 배열은 ColInfo가 아니므로 Excel이
// 열 속성을 일관되게 읽지 못한다. 모든 열을 명시적인 보이는 ColInfo로 내보내야 한다.
const rawExport = app.slice(app.indexOf("async function exportRawNews()"), app.indexOf("// 비교 리포트"));
assert.match(rawExport, /sheet\['!cols'\]\s*=\s*\[/, "Raw export must set column properties");
assert.match(rawExport, /\{\s*wch:\s*36,\s*hidden:\s*false\s*\}/, "Raw export must use visible SheetJS ColInfo objects, not numeric widths");
assert.doesNotMatch(rawExport, /sheet\['!cols'\]\s*=\s*\[36,18,14,60/, "Numeric column-width arrays can be misread as column metadata");

console.log("raw export column visibility check passed");
