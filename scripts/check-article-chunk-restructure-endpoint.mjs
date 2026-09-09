// 운영 관리자 경로의 기사 청크 재구성 안전 조건. 네트워크 호출 없음.
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

assert.match(source, /article_chunks=1은 읽기 전용 미리보기/, "미리보기 동작을 문서화해야 한다");
assert.match(source, /articleChunkMode === "write"/, "명시적 write일 때만 DB를 바꿔야 한다");
assert.match(source, /Math\.min\(20, Math\.max\(1, Number\(requestedLimit\) \|\| ARTICLE_CHUNK_DEFAULT_LIMIT\)\)/, "요청당 기사 수 상한이 있어야 한다");
assert.match(source, /await supabaseRest\("knowledge_chunk\?on_conflict=content_hash"/, "새 청크를 먼저 저장해야 한다");
assert.match(source, /const existing = await supabaseRest\(`knowledge_chunk\?select=id,content_hash/, "기존 조각을 조회해 삭제 대상을 확정해야 한다");
assert.ok(source.indexOf('method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows')
  < source.indexOf('method: "DELETE", prefer: "return=minimal"'), "새 청크 저장이 이전 청크 삭제보다 앞서야 한다");
assert.match(source, /ARTICLE_CHUNK_RESTRUCTURE_FAILED/, "기사별 실패를 기록해야 한다");
assert.match(source, /splitArticleChunkText/, "기존 저장 청크에서만 본문을 복원해야 한다");

console.log("article chunk restructure endpoint checks passed");
