// 웹 백필이 한국어 문장만 저장하는지 확인한다. API 호출 없음.
//
// 2026-09-07: Reshine 수동 백필(2023~2026, 12건)에서 모델이 title_ko·fact_ko·original_excerpt_ko를
// 전부 중국어 원문 그대로 돌려줬고 그대로 저장됐다. 그때 event 712건 중 중국어 제목은 이 12건뿐이었다
// (다른 web_backfill 49건 포함 나머지는 전부 한국어). 프롬프트는 어겨질 수 있으므로 서버가 막는다.
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.OPENAI_API_KEY = "test-only"; process.env.OPENAI_MODEL = "test";
const { hasKorean } = await import("../lib/event-backfill.js");

// 판정 자체
assert.ok(hasKorean("란저우 LFP 10만 톤 완공"), "한국어 문장은 통과해야 한다");
assert.ok(hasKorean("창업판 IPO 신청 접수(募资 37.8억 위안)"), "원문 병기가 섞인 한국어도 통과해야 한다");
assert.ok(!hasKorean("南通瑞翔申请单晶型三元正极材料制备专利"), "중국어만 있는 문장은 걸러야 한다");
assert.ok(!hasKorean("Reshine files IPO application"), "영어만 있는 문장도 걸러야 한다");
assert.ok(!hasKorean(""), "빈 값은 통과시키지 않는다");

const source = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");

// 저장 경로에 실제로 걸려 있는지. 판정 함수만 있고 쓰지 않으면 아무것도 막지 못한다.
assert.ok(/dropped = \{[^}]*notKorean: 0/.test(source), "웹 백필의 dropped 집계에 notKorean이 있어야 한다");
assert.ok(/if \(!hasKorean\(title\) \|\| !hasKorean\(fact\)\) \{\s*\n\s*dropped\.notKorean \+= 1;/.test(source),
  "title_ko·fact_ko에 한글이 없으면 그 건을 버려야 한다");

// original_excerpt는 원문이므로 검사 대상이 아니다. 검사하면 정상 건이 전부 버려진다.
assert.ok(!/hasKorean\(\s*(event\.)?original_excerpt\s*\)/.test(source), "원문 발췌에는 한국어를 요구하지 않는다");

// 프롬프트도 필드를 짚어 다시 못박는다.
const web = source.slice(source.indexOf("const INSTRUCTIONS"), source.indexOf("const DIGEST_INSTRUCTIONS"));
assert.ok(web.includes("title_ko·fact_ko·original_excerpt_ko는 반드시 한국어 문장으로 쓴다"), "한국어 요구를 필드 이름으로 명시해야 한다");

console.log("backfill korean-output checks passed");
