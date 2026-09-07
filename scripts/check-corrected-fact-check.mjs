import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptedFactCheck, ARTICLE_FACT_CHECK_PROMPT } from "../api/process-article.js";

const analysis = {
  title_ko: "과장된 1차 제목",
  summary_ko: "- 확인된 사실\n- 본문에 없는 전망",
  event_title_ko: "과장된 이벤트",
  event_fact_ko: "확인된 수치와 본문에 없는 수치",
  timeline_eligibility: "reference",
};

const corrected = {
  verdict: "corrected_pass",
  title_ko: "본문으로 확인된 제목",
  summary_ko: "- 확인된 사실",
  keywords_ko: ["생산"],
  headline_signals: [{ keyword_ko: "생산", direction: "neutral", reason_ko: "본문 확인" }],
  event_title_ko: "확인된 이벤트",
  event_fact_ko: "본문으로 확인된 수치",
  original_excerpt: "원문 근거",
  original_excerpt_ko: "원문 근거 번역",
  reason_ko: "본문에 없는 전망과 수치를 제거함",
};

const accepted = acceptedFactCheck(analysis, corrected);
assert.ok(accepted, "부분 오류를 교정한 기사는 폐기하지 않아야 한다");
assert.equal(accepted.event_title_ko, corrected.event_title_ko, "이벤트 제목도 검증자 수정본을 사용해야 한다");
assert.equal(accepted.event_fact_ko, corrected.event_fact_ko, "제거한 사실이 1차 이벤트에서 다시 유입되면 안 된다");
assert.equal(accepted.summary_ko, corrected.summary_ko, "기사 요약은 검증자 수정본을 사용해야 한다");

assert.equal(acceptedFactCheck(analysis, { ...corrected, verdict: "reject" }), null, "쓸 수 있는 사실이 없는 기사는 계속 기각해야 한다");

const source = fs.readFileSync(new URL("../api/process-article.js", import.meta.url), "utf8");
assert.ok(ARTICLE_FACT_CHECK_PROMPT.includes("일부 오류만 있다는 이유로 기사 전체를 reject하지 않는다"), "부분 오류와 전체 기각을 구분해야 한다");
assert.ok(source.includes("const verifiedResult = acceptedFactCheck(result, factCheck)"), "실제 기사 처리 경로가 교정본 채택 함수를 사용해야 한다");
assert.ok(source.includes('factCheck.verdict === "corrected_pass" ? "corrected" : "fact_checked"'), "교정 통과를 운영 데이터에서 구분할 수 있어야 한다");

console.log("corrected fact-check checks passed");
