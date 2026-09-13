// 신호의 주체: 모델이 신호마다 주체 회사를 고르고, 서버는 연결 회사인지 확인한다. Sankey는 그 주체에만 선을 그린다.
// 2026-09-11 운영 DB 점검에서 여러 회사 연결 기사의 신호 124개가 선 380개로 복사된 문제를 근본적으로 고친다. 네트워크 없이 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveSubjectIds, attachSubjects, applyBackfill, NAME_TERMS, SIGNAL_SUBJECT_RULE } from "../lib/signal-subjects.js";
import { sankeyFlowsFromArticles } from "../lib/sankey-normalization.js";

// 모델이 적은 이름 → 연결 회사 id. 연결 회사가 아니면 버린다. 한국어 표기 차이도 잡는다.
assert.deepEqual(resolveSubjectIds(["닝더스다이(CATL)"], ["catl", "byd"]), ["catl"]);
assert.deepEqual(resolveSubjectIds(["후난위능"], ["catl", "hunan-yuneng"]), ["hunan-yuneng"], "후난위능 표기도 후난위넝으로 본다");
assert.deepEqual(resolveSubjectIds(["샤오미"], ["calb", "sunwoda"]), [], "연결 회사가 아닌 이름은 버린다");
assert.ok(NAME_TERMS.get("fulin-precision").includes("푸린징궁"), "점검에서 못 찾은 표기를 판정용 사전에 더한다");

const signals = attachSubjects([
  { direction: "contraction", keyword_ko: "고급 배터리 주문", reason_ko: "…", subject_scope: "company", subjects_ko: ["닝더스다이(CATL)"] },
  { direction: "expansion", keyword_ko: "글로벌 출하", reason_ko: "…", subject_scope: "industry", subjects_ko: ["닝더스다이(CATL)"] },
  { direction: "expansion", keyword_ko: "샤오미 협력", reason_ko: "…", subject_scope: "company", subjects_ko: ["샤오미"] },
], ["byd", "calb", "catl"]);
assert.deepEqual(signals[0].subject_company_ids, ["catl"]);
assert.deepEqual(signals[1].subject_company_ids, [], "산업 전반 신호는 회사를 비운다");
assert.equal(signals[2].subject_scope, "unresolved", "회사라고 했지만 연결 회사로 못 되돌리면 unresolved로 두고 예비 규칙을 쓴다");

// 재판정: 신호 문장은 그대로, 주체만 채운다.
const backfilled = applyBackfill({ linked_ids: ["catl", "hunan-yuneng"], headline_signals: [
  { direction: "contraction", keyword_ko: "지분율", reason_ko: "CATL이 후난위능 주식을 매각" },
  { direction: "expansion", keyword_ko: "매출 성장", reason_ko: "후난위능 상반기 매출 348.77억 위안" },
] }, { signals: [
  { index: 0, subject_scope: "company", subjects_ko: ["닝더스다이(CATL)"] },
  { index: 1, subject_scope: "company", subjects_ko: ["후난위넝"] },
] });
assert.equal(backfilled[0].reason_ko, "CATL이 후난위능 주식을 매각", "신호 문장은 바꾸지 않는다");
assert.deepEqual(backfilled.map(signal => signal.subject_company_ids), [["catl"], ["hunan-yuneng"]]);

// 규칙 v2(2026-09-11): 완성차가 공급처·협력사로 정한 추적 회사는 확대 신호의 주체. 영향받는 예전 판정(other_company)만 재판정한다.
{
  const { needsSubjectJudgement, SUBJECT_RULE_VERSION } = await import("../lib/signal-subjects.js");
  assert.match(SIGNAL_SUBJECT_RULE, /공급사·협력사로 선정·추가된 \[연결 회사\]를 확대 신호의 주체로 적는다/);
  assert.equal(needsSubjectJudgement({ direction: "expansion", subject_scope: "other_company" }), true, "v1의 추적 외 회사 판정은 다시 본다");
  assert.equal(needsSubjectJudgement({ direction: "expansion", subject_scope: "company", subject_company_ids: ["catl"] }), false, "v1의 회사 판정은 그대로 둔다");
  assert.equal(needsSubjectJudgement({ direction: "expansion", subject_scope: "industry" }), false, "v1의 산업 전반 판정은 그대로 둔다");
  assert.equal(needsSubjectJudgement({ direction: "expansion", subject_scope: "other_company", subject_rule_version: SUBJECT_RULE_VERSION }), false, "새 규칙으로 판정한 것은 다시 보지 않는다");
  assert.equal(needsSubjectJudgement({ direction: "neutral" }), false);
  const kept = { direction: "contraction", keyword_ko: "고급 배터리 주문", reason_ko: "…", subject_scope: "company", subject_company_ids: ["catl"] };
  const mixed = applyBackfill({ linked_ids: ["byd", "calb", "catl"], headline_signals: [
    kept,
    { direction: "expansion", keyword_ko: "배터리 공급망 다변화", reason_ko: "샤오미가 중촹신항·신왕다와 룽자 배터리 발표", subject_scope: "other_company", subject_company_ids: [] },
  ] }, { signals: [{ index: 1, subject_scope: "company", subjects_ko: ["중촹신항(CALB)"] }] });
  assert.deepEqual(mixed[0], kept, "재판정 대상이 아닌 신호는 저장된 그대로 둔다");
  assert.deepEqual(mixed[1].subject_company_ids, ["calb"], "공급사로 선정된 중촹신항이 확대 신호의 주체가 된다");
  assert.equal(mixed[1].subject_rule_version, SUBJECT_RULE_VERSION);
}

// Sankey: 모델이 고른 주체에만 선을 그리고, 산업 전반·추적 외 회사 신호는 회사 선을 그리지 않는다.
const article = {
  id: "x", published_at: "2026-09-09T02:00:00Z", title_ko: "에너지저장 기업 상반기 실적 양극화…글로벌 출하 461.3GWh",
  article_company: [{ company_id: "catl" }, { company_id: "byd" }, { company_id: "calb" }],
  headline_signals: [
    { direction: "expansion", keyword_ko: "에너지저장 배터리 출하량", reason_ko: "2026년 상반기 글로벌 출하량이 461.3GWh로 증가", subject_scope: "industry", subject_company_ids: [] },
    { direction: "contraction", keyword_ko: "저장시스템 단가", reason_ko: "저장시스템 단가 65% 하락", subject_scope: "industry", subject_company_ids: [] },
    { direction: "expansion", keyword_ko: "출하량 증가", reason_ko: "비야디 에너지저장 출하량 증가로 상위 5위 유지", subject_scope: "company", subject_company_ids: ["byd"] },
  ],
};
const flows = sankeyFlowsFromArticles([article], []);
assert.deepEqual(flows.map(flow => flow.company_id), ["byd"], "산업 전반 신호는 7개사에 복사되지 않고, 회사 신호는 그 회사에만 그린다");
// 주체 판정이 없는 예전 기사는 이름 매칭으로 가린다(예비 규칙).
const legacy = sankeyFlowsFromArticles([{ ...article, headline_signals: [{ direction: "expansion", keyword_ko: "출하량 증가", reason_ko: "비야디 에너지저장 출하량 증가" }] }], []);
assert.deepEqual(legacy.map(flow => flow.company_id), ["byd"]);

// 새 기사: 원문 분석 호출이 신호마다 주체를 적게 하고, 연결 회사 목록을 준다.
const processArticle = fs.readFileSync(new URL("../api/process-article.js", import.meta.url), "utf8");
assert.equal((processArticle.match(/\.\.\.Object\.keys\(SIGNAL_SUBJECT_PROPERTIES\)/g) || []).length, 1, "원문 분석 스키마가 신호별 주체 필드를 요구한다");
assert.match(processArticle, /ARTICLE_ANALYSIS_PROMPT_BODY \+ LAYER_PROMPT_GUIDE \+ " " \+ SIGNAL_SUBJECT_RULE/);
assert.doesNotMatch(processArticle, /ARTICLE_FACT_CHECK_PROMPT|factCheckArticle/, "교차대조 호출은 남아 있지 않아야 한다");
assert.match(processArticle, /\[연결 회사\]/, "모델에 연결 회사 목록을 준다");
assert.match(processArticle, /headline_signals: attachSubjects\(verifiedResult\.headline_signals \|\| \[\], linkedIds\)/, "저장 전에 서버가 주체를 연결 회사로 확인한다");
assert.match(SIGNAL_SUBJECT_RULE, /이름만 언급됐거나 비교 대상·경쟁사로 나온 회사는 넣지 않는다/);
assert.match(SIGNAL_SUBJECT_RULE, /산업·시장 전체 수치/);

// 기존 기사 재판정은 관리자 화면에서 부른다.
const admin = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
assert.match(admin, /"signal-subjects-backfill": signalSubjectsBackfill/);
const adminApp = fs.readFileSync(new URL("../app/admin.js", import.meta.url), "utf8");
assert.match(adminApp, /postApi\('signal-subjects-backfill'/);

console.log("signal subject checks passed");
