import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./process-pending-range.mjs", import.meta.url), "utf8");
assert.match(source, /verification_status=eq\.pending/, "일괄 작업은 pending만 대상으로 해야 한다");
assert.match(source, /published_at=gte\.\$\{from\}.*published_at=lt\.\$\{to\}.*order=published_at\.desc,id\.desc/, "날짜 범위 안에서 최신 기사부터 처리해야 한다");
assert.match(source, /for \(let offset = 0; ; offset \+= PAGE_SIZE\)/, "Supabase 페이지 상한을 넘어도 대상 전체를 읽어야 한다");
assert.match(source, /processPendingArticle\(article\.id, companyId\)/, "일반 본문 검증·임베딩 경로를 재사용해야 한다");
assert.match(source, /--dry-run/, "실행 전 읽기 전용 대상 확인을 제공해야 한다");
console.log("pending range batch checks passed");
