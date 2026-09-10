// 자동 본문 대조 통과 상태는 verified 하나다. 옛 이름 pending_review는 2026-09-10 운영 DB에서
// 이관을 마쳤으므로(supabase/verification-status-verified.sql) 코드가 다시 쓰거나 읽으면 안 된다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url);
const offenders = [];
for (const dir of ["api", "lib", "app"]) {
  for (const name of fs.readdirSync(new URL(`${dir}/`, root))) {
    if (!/\.(js|html)$/.test(name)) continue;
    const text = fs.readFileSync(new URL(`${dir}/${name}`, root), "utf8");
    if (text.includes("pending_review")) offenders.push(path.posix.join(dir, name));
  }
}
assert.deepEqual(offenders, [], `옛 상태 이름 pending_review가 남아 있다: ${offenders.join(", ")}`);
const processArticle = fs.readFileSync(new URL("api/process-article.js", root), "utf8");
assert.match(processArticle, /verification_status: "verified"/, "본문 대조 통과 기사는 verified로 저장한다");

console.log("verification status checks passed");
