// 공시가 뉴스 뒤에 서면 훅마다 새 뉴스 10건이 앞을 채워 공시 차례가 오지 않는다(2026-09-08~09-10 처리 0건).
// 훅마다 공시 일부를 맨 앞에 두는지 소스로 고정한다. 네트워크 없음.
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
assert.match(src, /const DISCLOSURE_FRONT_PER_HOP = 2;/, "훅마다 공시 2건을 먼저 처리한다");
assert.match(src, /const front = disclosures\.slice\(0, DISCLOSURE_FRONT_PER_HOP\);/);
assert.match(src, /for \(const article of \[\.\.\.front, \.\.\.policies, \.\.\.news, \.\.\.disclosures\.slice\(DISCLOSURE_FRONT_PER_HOP\), \.\.\.bootstrap\]\)/,
  "처리 순서는 앞 공시 → 정책 → 뉴스 → 나머지 공시 → bootstrap이다");
assert.match(src, /const DISCLOSURE_PER_RUN = 4;/, "선별 몫은 그대로 4건이다");

console.log("disclosure order checks passed");
