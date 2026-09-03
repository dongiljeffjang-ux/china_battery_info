// 모든 API 모듈을 실제로 import해 로드 오류를 잡는다.
// node --check는 구문만 검사한다. 같은 함수 안의 let/const 이름 충돌처럼 링크 단계에서 터지는 오류는
// 실제로 불러봐야 드러나고, 그런 오류는 배포 후 모든 호출을 500으로 만든다.
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
let failed = 0;
for (const file of readdirSync("api").filter((name) => name.endsWith(".js"))) {
  try { await import(pathToFileURL(`api/${file}`).href); console.log("ok   ", file); }
  catch (error) { failed += 1; console.error("FAIL ", file, "→", error.message); }
}
if (failed) process.exit(1);
