// 정책-기업 연결 웹 재검토: 근거 없는 직접·간접 판정은 판정불가로 내리고, 초안과 동시에 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";

const { cleanPolicyLinks } = await import("../lib/compare-report.js");

const policy = (id, title) => ({ id, title_ko: title, occurred_at: "2025-10-09" });
const labeled = [{ ref: "P1", policy: policy("policy-history-30", "리튬전지·인조흑연 음극재 수출통제") }, { ref: "P2", policy: policy("policy-history-33", "소비세 조정") }];
const eventA = { id: "f6b4f9c6-d39c-4f59-977f-640ccd8c066b", title: "고압실 인산철리튬 양극재 양산 스펙", date: "2026-06-30" };
const eventB = { id: "11111111-2222-3333-4444-555555555555", title: "CATL 이벤트", date: "2026-01-01" };
const eventOwner = new Map([[eventA.id, { side: "A", event: eventA }], [eventB.id, { side: "B", event: eventB }]]);

const out = cleanPolicyLinks({ analysis_ko: "• 해석", links: [
  { policy_ref: "P1", company: "A", relation: "direct", path_ko: "압실밀도 2.6g/cm³ 양산", basis_event_id: eventA.id, source_url: "" },
  { policy_ref: "P1", company: "A", relation: "none", path_ko: "중복", basis_event_id: "", source_url: "" },
  { policy_ref: "P1", company: "B", relation: "indirect", path_ko: "근거 없음", basis_event_id: eventA.id, source_url: "" },
  { policy_ref: "P2", company: "B", relation: "indirect", path_ko: "웹 문서", basis_event_id: "", source_url: "https://example.com/doc" },
  { policy_ref: "P9", company: "A", relation: "direct", path_ko: "없는 정책", basis_event_id: eventA.id, source_url: "" },
] }, labeled, eventOwner);

assert.equal(out.links.length, 3, "없는 정책 번호와 같은 정책·회사 중복은 버린다");
assert.equal(out.links[0].relation, "direct");
assert.equal(out.links[0].basis_title, eventA.title, "근거 이벤트 제목을 화면용으로 붙인다");
assert.equal(out.links[0].policy_id, "policy-history-30", "P 번호를 원래 정책 id로 되돌린다");
assert.equal(out.links[1].relation, "undetermined", "다른 회사의 이벤트를 근거로 댄 판정은 판정불가로 내린다");
assert.equal(out.links[1].basis_event_id, "");
assert.equal(out.links[2].relation, "indirect", "실제 문서 주소가 있으면 간접 판정을 남긴다");
assert.equal(out.downgraded, true, "내린 판정이 있으면 표시해 해석 문단을 쓰지 않게 한다");
assert.equal(cleanPolicyLinks({ analysis_ko: "", links: [] }, labeled, eventOwner).downgraded, false);

const lib = fs.readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
assert.ok(lib.indexOf("const policyCheck = selectedPolicies.length") < lib.indexOf('name: "compare_report_draft"'), "정책 재검토는 초안 작성 전에 시작해 병렬로 돈다");
assert.equal((lib.match(/return withPolicyCheck\(/g) || []).length, 2, "검증 성공·실패 두 경로 모두 정책 재검토 결과를 붙인다");
assert.match(lib, /if \(checked\?\.analysis_ko && !checked\.downgraded\)/, "판정을 내린 경우 재검토 해석으로 바꾸지 않는다");
assert.match(lib, /webSearch: true,\s*timeoutMs: POLICY_LINK_TIMEOUT_MS/, "정책 재검토는 웹 검색을 쓴다");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(app, /function policyLinksHtml\(r, payload\)/, "비교 리포트 화면에 정책 연결 판정을 그린다");

console.log("policy links checks passed");
