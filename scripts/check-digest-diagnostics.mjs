import assert from "node:assert/strict";
import fs from "node:fs";

// 보고서 추출 진단값 회귀. 네트워크를 쓰지 않는다. API 과금이 없다.
//
// 지키려는 성질.
//   1. 조각 하나가 죽어도 나머지 조각의 사실은 살아남는다. 예전에는 Promise.all이라
//      마지막 조각의 타임아웃이 앞 조각들의 결과까지 통째로 버렸다.
//   2. 부분 결과로 옛 이벤트를 지우지 않는다. 지우고 부분으로 채우면 그 구간이 영구히 사라진다.
//   3. digestReport가 낸 진단값이 세 저장 경로 모두에서 장부에 적힌다.
//   4. 진단 저장 실패가 실제 데이터 저장을 막지 않는다(SQL 미적용 상태에서도 파이프라인이 돈다).
//   5. 버린 날짜의 표본을 남긴다. 표본이 없으면 프롬프트 문제와 정규화 문제를 구분할 수 없다.

const backfill = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");
const curation = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/report-digest-diagnostics.sql", import.meta.url), "utf8");

const digest = backfill.slice(backfill.indexOf("export async function digestReport"), backfill.indexOf("// 이미 저장된 연차보고서 이벤트의 시점"));
assert.ok(digest.length > 500, "digestReport 구간을 찾지 못했다");

// --- 1) 조각 부분 실패 보존 -------------------------------------------------

assert.ok(digest.includes("Promise.allSettled(chunks.map("), "조각 호출은 allSettled여야 한다");
assert.ok(!/Promise\.all\(chunks\.map\(/.test(digest), "Promise.all이 남아 있으면 조각 하나의 실패가 전체를 버린다");
assert.ok(/if \(!parts\.length\) throw settled\[0\]\.reason;/.test(digest), "조각이 전부 죽었을 때만 올려보내야 한다");
assert.ok(digest.includes("chunkErrors.push("), "실패한 조각을 세야 한다");

// --- 2) 진단값 반환 ---------------------------------------------------------

for (const field of [
  "section_chars", "digest_chunks", "digest_chunks_failed", "digest_returned",
  "digest_dropped_bad_date", "digest_dropped_empty", "digest_prompt_version",
  "digest_dropped_ungrounded_excerpt",
]) {
  assert.ok(digest.includes(`${field}:`), `digestReport의 diagnostics에 ${field}가 있어야 한다`);
}
assert.ok(digest.includes("per_chunk_returned: perChunkReturned"), "조각별 산출 건수를 돌려줘야 한다");
// 분모는 body_chars가 아니라 section_chars다. 원문 길이로 나누면 밀도가 실제보다 낮게 나온다.
assert.ok(/section_chars: report\.section\?\.length/.test(digest), "section_chars는 실제로 LLM에 넣은 구간의 길이여야 한다");

assert.ok(/export const DIGEST_PROMPT_VERSION = crypto\.createHash\("sha256"\)\.update\(DIGEST_INSTRUCTIONS\)/.test(backfill),
  "프롬프트 버전은 지시문 자체의 해시여야 한다. 손으로 올리는 번호는 바뀐 걸 잊는다");

// --- 3) 버린 날짜의 표본 ----------------------------------------------------

assert.ok(digest.includes("badDateSamples"), "버린 날짜 표기의 표본을 남겨야 한다");
assert.ok(/dropped\.badDateSamples\.length < 5/.test(digest), "표본은 상한을 둬야 한다");

// --- 3.1) 보고서 원문 근거 정합성 ------------------------------------------

assert.ok(backfill.includes("isGroundedReportExcerpt"), "보고서 원문 발췌를 입력 조각에서 재검증해야 한다");
assert.ok(/ungroundedExcerpt/.test(digest), "근거 없는 발췌는 저장 후보에서 제외해야 한다");
const { isGroundedReportExcerpt } = await import("../lib/event-backfill.js");
assert.equal(isGroundedReportExcerpt("매출 1,200만원", "표 행 | 매출 1,200만원 | 전년 900만원"), true);
assert.equal(isGroundedReportExcerpt("매출 1,300만원", "표 행 | 매출 1,200만원 | 전년 900만원"), false, "숫자를 바꾼 발췌는 차단한다");
assert.equal(isGroundedReportExcerpt("짧음", "짧음이 포함된 원문"), false, "너무 짧은 발췌는 근거로 쓰지 않는다");

// --- 4) 세 저장 경로가 진단값을 적는다 ---------------------------------------

assert.ok(curation.includes("async function writeDigestDiagnostics("), "진단 저장 헬퍼가 있어야 한다");
const helper = curation.slice(curation.indexOf("async function writeDigestDiagnostics("), curation.indexOf("// 회사 하나의 특정 창에"));
assert.ok(/\}\)\.catch\(/.test(helper), "진단 저장 실패는 삼켜야 한다. SQL 미적용 상태에서 파이프라인이 죽으면 안 된다");
assert.ok(helper.includes("DIGEST_DIAGNOSTICS_SKIPPED"), "삼킨 실패는 로그로 남겨야 한다");

const calls = curation.match(/await writeDigestDiagnostics\(/g) || [];
assert.equal(calls.length, 3, "digestCompany·enrichReport·renewReport 세 곳 모두 진단값을 적어야 한다");
for (const fn of ["digestCompany", "enrichReport", "renewReport"]) {
  const start = curation.indexOf(`export async function ${fn}(`);
  assert.ok(start > 0, `${fn}을 찾지 못했다`);
  const body = curation.slice(start, start + 3000);
  assert.ok(body.includes("writeDigestDiagnostics("), `${fn}이 진단값을 적어야 한다`);
  assert.ok(/diagnostics(,|\s*\})/.test(body), `${fn}이 digestReport에서 diagnostics를 받아야 한다`);
}

// 진단 PATCH는 실제 데이터 PATCH와 분리돼야 한다. 합치면 없는 컬럼 하나가 parse_quality까지 날린다.
assert.ok(!/body: \{[^}]*digest_returned/.test(curation), "진단값을 실제 데이터 PATCH 본문에 섞으면 안 된다");

// --- 5) 부분 결과로 옛 이벤트를 지우지 않는다 --------------------------------

const renewal = curation.slice(curation.indexOf("export async function renewReport"), curation.indexOf("export async function webBackfillCompany"));
assert.ok(/const partial = \(diagnostics\?\.digest_chunks_failed \|\| 0\) > 0;/.test(renewal),
  "조각 실패 여부로 부분 결과를 판정해야 한다");
assert.ok(/const canReplace = !partial &&/.test(renewal),
  "부분 결과일 때는 건수가 하한을 넘어도 옛 이벤트를 지우면 안 된다");
// 기존 하한도 그대로 살아 있어야 한다.
assert.ok(/RENEW_REPLACE_MIN_EVENTS = 3/.test(curation) && /RENEW_REPLACE_MIN_RATIO = 0\.5/.test(curation),
  "바꿔 넣기 하한(3건, 옛 건수의 50%)은 유지해야 한다");

// --- 6) 마이그레이션이 코드와 같은 컬럼을 만든다 ------------------------------

for (const column of [
  "section_chars", "digest_chunks", "digest_chunks_failed", "digest_returned",
  "digest_dropped_bad_date", "digest_dropped_empty", "digest_prompt_version",
  "digest_dropped_ungrounded_excerpt",
]) {
  assert.ok(migration.includes(`add column if not exists ${column}`), `SQL에 ${column} 컬럼이 있어야 한다`);
}
assert.ok(migration.includes("alter table public.report_digest"), "진단 컬럼은 report_digest에 붙는다");
assert.ok(!/drop column/i.test(migration), "마이그레이션이 컬럼을 지우면 안 된다");

console.log("ok  digest-diagnostics");
