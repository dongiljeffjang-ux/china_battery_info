// 정책–회사 연결: 회사 사건을 출발점으로 LLM이 추론하고, 서버가 근거 사건 번호를 대조해 저장한다.
// 보고서에는 연결된 정책만 들어간다. 네트워크 없이 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";
import { historicalPolicies } from "../lib/policy-context.js";
import { buildLinkInput, cleanLinks, isStale, policyHash, uniquePolicies, linkedPolicyTable, compareLinkedPolicyTable, reportPolicyLinks, basePolicyId } from "../lib/policy-links.js";
import { buildTimelineInput } from "../lib/timeline-report.js";

const policies = historicalPolicies();
const unique = uniquePolicies(policies);
assert.equal(unique.length, 35, "발표·시행 일정 행은 정책 단위 하나로 합쳐 판정한다");
assert.ok(unique.every(policy => !/-schedule-/.test(policy.id) && !/시행·유예 일정/.test(policy.title_ko)));
assert.equal(basePolicyId("policy-history-3-schedule-2027-12-31"), "policy-history-3");
assert.equal(policyHash(policies), policyHash([...policies].reverse()), "지문은 순서와 무관하다");
assert.notEqual(policyHash(policies), policyHash(policies.slice(1)), "정책이 바뀌면 지문이 바뀐다");

const company = { id: "gotion", name_ko: "궈쉬안하이테크(Gotion)", name_zh: "国轩高科", name_en: "Gotion", type_tags: ["cell"] };
const events = [
  { id: "11111111-1111-1111-1111-111111111111", occurred_at: "2025-06-30", layer_key: "regional-overseas", title_ko: "모로코 배터리 공장 착공", fact_ko: "연 20GWh" },
  { id: "22222222-2222-2222-2222-222222222222", occurred_at: "2024-03-01", layer_key: "technology-material-chemistry", title_ko: "LFP 셀 양산", fact_ko: "에너지밀도 190Wh/kg" },
  { id: "", occurred_at: "2024-01-01", title_ko: "id 없는 사건은 근거로 못 쓴다" },
];
const { input, refs, policyRefs } = buildLinkInput({ company, events, policies });
assert.equal(refs.length, 2, "id 없는 사건은 입력에서 뺀다");
assert.equal(refs[0].event.occurred_at, "2024-03-01", "사건은 과거 → 최근");
assert.equal(policyRefs.length, 35);
assert.match(input, /E1 \| 2024-03-01/);
assert.match(input, /P1 \|/);
assert.match(input, /밸류체인: cell/);

const exportPolicy = policyRefs.find(({ policy }) => /수출/.test(policy.title_ko));
const other = policyRefs.find(({ ref }) => ref !== exportPolicy.ref);
const { links, dropped } = cleanLinks({ links: [
  { policy_ref: exportPolicy.ref, relation: "indirect", path_ko: "수출통제가 해외 공장 조달 조건에 작용할 수 있다", basis_event_refs: ["E2", "E9"] },
  { policy_ref: exportPolicy.ref, relation: "direct", path_ko: "같은 정책 중복", basis_event_refs: ["E1"] },
  { policy_ref: other.ref, relation: "direct", path_ko: "근거 없는 연결", basis_event_refs: ["E9"] },
  { policy_ref: "P99", relation: "direct", path_ko: "없는 정책", basis_event_refs: ["E1"] },
  { policy_ref: other.ref, relation: "none", path_ko: "허용되지 않는 관계", basis_event_refs: ["E1"] },
] }, refs, policyRefs);
assert.equal(links.length, 1, "근거 사건이 없거나 없는 정책·관계·중복 연결은 버린다");
assert.equal(dropped, 4);
assert.equal(links[0].policy_id, exportPolicy.policy.id, "P 번호를 원래 정책 id로 되돌린다");
assert.deepEqual(links[0].basis.map(item => item.event_id), [events[0].id], "없는 사건 번호는 빼고 실제 사건 id만 남긴다");
assert.match(links[0].policy_verification, /미검증/, "첨부 정책의 미검증 표시를 연결에 싣는다");

const now = Date.parse("2026-09-11T00:00:00Z");
const fresh = { policy_hash: "h", checked_at: "2026-09-10T00:00:00Z", event_count: 100 };
assert.equal(isStale(fresh, { hash: "h", eventCount: 102, now }), false);
assert.equal(isStale(fresh, { hash: "x", eventCount: 100, now }), true, "정책 집합이 바뀌면 다시 판정");
assert.equal(isStale(fresh, { hash: "h", eventCount: 105, now }), true, "사건이 5건 이상 늘면 다시 판정");
assert.equal(isStale({ ...fresh, checked_at: "2026-09-01T00:00:00Z" }, { hash: "h", eventCount: 100, now }), true, "7일이 지나면 다시 판정");
assert.equal(isStale(null, { hash: "h", eventCount: 0, now }), true);

const table = linkedPolicyTable(links, policies);
assert.match(table, /이 회사에 닿는 경로\(추론\)/);
assert.match(table, /간접/);
assert.match(table, /2025-06-30 모로코 배터리 공장 착공/);
const input2 = buildTimelineInput({ companyName: "궈쉬안", events: [], policies, policyLinks: links });
assert.match(input2, /연결 경로가 판정된 중국 정책 1건/);
assert.doesNotMatch(input2, /대표 정책/, "연결 없는 정책을 대표로 뽑아 넣지 않는다");
assert.doesNotMatch(buildTimelineInput({ companyName: "궈쉬안", events: [], policies, policyLinks: [] }), /중국 정책/, "연결이 없으면 정책을 입력하지 않는다");

const cmp = compareLinkedPolicyTable(links, [], policies, "궈쉬안", "CATL");
assert.match(cmp, /B CATL에 닿는 경로/);
assert.match(cmp, /연결 판정 없음/, "한쪽에만 닿는 정책은 그 차이가 보여야 한다");
const shaped = reportPolicyLinks(links, links);
assert.deepEqual(shaped.map(link => link.company), ["A", "B"]);
assert.equal(shaped[0].basis_title, "모로코 배터리 공장 착공", "비교 화면의 기존 연결 목록 형식을 유지한다");

const rule = fs.readFileSync(new URL("../lib/policy-context.js", import.meta.url), "utf8");
assert.doesNotMatch(rule, /부록의 참고자료로 이동하라/, "정책을 부록으로 밀어내는 지시를 두지 않는다");
assert.doesNotMatch(rule, /selectReportPolicies/, "단어 일치로 정책을 고르는 선별기를 두지 않는다");
const compare = fs.readFileSync(new URL("../lib/compare-report.js", import.meta.url), "utf8");
assert.doesNotMatch(compare, /checkPolicyLinks|webSearch: true,\s*timeoutMs: POLICY_LINK_TIMEOUT_MS/, "비교 보고서의 정책 웹 재검토는 저장된 연결로 대체했다");
const api = fs.readFileSync(new URL("../api/company.js", import.meta.url), "utf8");
assert.match(api, /includePolicy \? await loadCompanyPolicyLinks\(company, policies\)/, "시계열 보고서는 재시도 바깥에서 연결을 한 번만 판정한다");
assert.match(api, /loadPolicyLinkRow\(companyId\)\.catch\(\(\) => null\)/, "기업 화면은 저장된 연결만 읽고 판정하지 않는다");
const sql = fs.readFileSync(new URL("../supabase/company-policy-link.sql", import.meta.url), "utf8");
assert.match(sql, /create table if not exists public\.company_policy_link/);
assert.match(sql, /revoke all on public\.company_policy_link from anon, authenticated/);
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(app, /function policyLinksHtml\(r, payload\)/, "비교 리포트 화면에 정책 연결을 그린다");
assert.match(app, /policyCell\(policies, period, timeline\.policyLinks\)/, "기업 시간축 정책 줄에 연결 표시를 단다");

console.log("policy links checks passed");
