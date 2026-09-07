import assert from "node:assert/strict";
import fs from "node:fs";

// 핵심(core) 등급은 거래소에 제출된 공시·정기보고서 원문에만 준다.
// 회사가 자기 채널에 낸 보도자료(CATL 뉴스룸), 회사 홈페이지 뉴스, 언론의 공고 전재는 1차 출처처럼
// 보이지만 법정 공시가 아니고 우리가 원문을 대조한 것도 아니므로 보조(reference)다.
// 등급을 모델이 고르게 했더니 프롬프트의 금지 문구에도 core를 골랐다(2026-09-07에 11건).
const article = fs.readFileSync(new URL("../api/process-article.js", import.meta.url), "utf8");
const backfill = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");

// 서버가 정한다: 공시가 아니면 무조건 reference. 모델의 exclude만 존중한다.
assert.ok(
  /timeline_eligibility: result\.timeline_eligibility === "exclude" \? "exclude" : isDisclosure \? "core" : "reference"/.test(article),
  "기사 등급은 서버가 정해야 한다. 공시가 아니면 reference, 모델 값은 exclude만 존중한다",
);
assert.ok(!/timeline_eligibility: isDisclosure \? "core" : result\.timeline_eligibility/.test(article), "모델이 고른 등급을 그대로 저장하면 안 된다");

// 프롬프트도 모델에게 core를 고르지 말라고 분명히 해야 한다.
assert.ok(article.includes("core는 고르지 않는다"), "추출 프롬프트가 모델에게 core를 고르지 말라고 해야 한다");

// 웹 백필은 본문 대조를 거치지 않으므로 항상 reference다.
const web = backfill.slice(backfill.indexOf("export async function backfillCompanyEvents"), backfill.indexOf("const DIGEST_INSTRUCTIONS"));
assert.ok(web.includes('timeline_eligibility: "reference"'), "웹 백필 이벤트는 reference로 고정해야 한다");

// 보고서 추출은 core다. 거래소에 제출된 원문을 우리가 직접 읽는 유일한 경로다.
const digest = backfill.slice(backfill.indexOf("const DIGEST_INSTRUCTIONS"));
assert.ok(digest.includes('timeline_eligibility: "core"'), "정기보고서 이벤트는 core여야 한다");

console.log("evidence grade checks passed");
