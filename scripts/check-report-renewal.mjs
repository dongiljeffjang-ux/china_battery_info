import assert from "node:assert/strict";
import fs from "node:fs";

const curation = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");
const reader = fs.readFileSync(new URL("../lib/report-reader.js", import.meta.url), "utf8");
const backfill = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/report-renewal.sql", import.meta.url), "utf8");

const renewal = curation.slice(curation.indexOf("export async function renewReport"), curation.indexOf("export async function webBackfillCompany"));
assert.ok(renewal.includes("storeEvents(company, rows)"), "갱신은 기존 중복 방지 저장 경로를 사용해야 한다");
// 2026-09-07 사용자 결정: 잘못 읽힌 정보는 지우고 다시 채운다. 다만 삭제는 그 보고서의 이벤트로만
// 좁히고, 새 읽기가 충분할 때만 한다. 얇은 읽기(timeout)로 좋은 데이터를 날리면 안 된다.
const deletes = renewal.match(/method: "DELETE"/g) || [];
assert.equal(deletes.length, 1, "갱신의 삭제는 한 곳뿐이어야 한다");
assert.ok(/const where = `company_id=eq\.\$\{encodeURIComponent\(company\.id\)\}&source_url=eq\.\$\{encodeURIComponent\(row\.report_url\)\}`/.test(renewal), "삭제 범위는 그 회사·그 보고서 URL로 좁혀야 한다");
assert.ok(/if \(canReplace\) \{[\s\S]*?method: "DELETE"/.test(renewal), "삭제는 새 읽기가 충분할 때(canReplace)만 해야 한다");
assert.ok(/RENEW_REPLACE_MIN_EVENTS = 3/.test(curation) && /RENEW_REPLACE_MIN_RATIO = 0\.5/.test(curation), "바꿔 넣기 하한(3건, 옛 건수의 50%)이 있어야 한다");
assert.ok(/const old = await supabaseRest\(`event\?select=id&\$\{where\}`\)/.test(renewal), "지우기 전에 지울 행을 먼저 조회해야 한다");
assert.ok(renewal.includes('"visual_review_required"'), "이미지 도표 페이지는 검토 대상으로 남겨야 한다");
assert.ok(reader.includes('createHash("sha256")'), "재다운로드한 PDF 원문 해시를 기록해야 한다");

// digestReport가 품질 메타를 떨어뜨리면 갱신·보강·수집이 전부 text_only로 기록된다.
// 실제로 그렇게 돌아 farasis 반기보고서가 해시 없이 갱신된 적이 있다(2026-09-07).
const digest = backfill.slice(backfill.indexOf("export async function digestReport"), backfill.indexOf("const REDATE_SCHEMA"));
for (const field of ["parse_quality", "visual_pages", "source_sha256"]) {
  assert.ok(new RegExp(`report:\\s*\\{[^}]*${field}:`).test(digest), `digestReport가 ${field}를 호출자에게 넘겨야 한다`);
}
for (const column of ["renewed_at", "renewal_status", "renewal_inserted", "source_sha256"]) {
  assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
}
assert.ok(!/\b(delete|truncate)\b/i.test(migration), "갱신 스키마는 기존 데이터를 삭제하면 안 된다");

console.log("report renewal checks passed");
