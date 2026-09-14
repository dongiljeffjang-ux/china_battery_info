import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POLICY_HISTORY } from '../lib/policy-history.js';
import { historicalPolicies, POLICY_ANALYSIS_RULE } from '../lib/policy-context.js';
import { buildTimelineInput } from '../lib/timeline-report.js';
import { companiesFor, POLICY_COMPANY_ID, TRACKED_COMPANIES } from '../lib/china-sources.js';

const policies = historicalPolicies();
assert.equal(POLICY_HISTORY.length, 35);
assert.equal(new Set(policies.map(p => p.id)).size, policies.length);
assert.ok(policies.every(p => p.evidence_kind === 'user_reference' && p.source_name.includes('미검증')));
assert.equal(policies.find(p => p.id === 'policy-history-22').occurred_precision, 'year');
assert.ok(policies.some(p => p.occurred_at === '2026-11-10' && p.title_ko.includes('유예')));
assert.ok(policies.some(p => p.occurred_at === '2027-07-01'));
assert.doesNotMatch(JSON.stringify(policies), /계약 체결|파이프라인을 강화하라|라인 비중을 확정/);
assert.deepEqual(companiesFor({ companyId: POLICY_COMPANY_ID }).map(c => c.id), [POLICY_COMPANY_ID]);
assert.ok(!TRACKED_COMPANIES.some(c => c.id === POLICY_COMPANY_ID));
const input = buildTimelineInput({ companyName: '테스트 기업', events: [], policies });
assert.doesNotMatch(input, /중국 정책/, '연결 판정 없이 정책을 보고서 입력에 넣지 않는다');
assert.match(POLICY_ANALYSIS_RULE, /연결 경로가 미리 판정된/);
assert.match(POLICY_ANALYSIS_RULE, /별도 목록이나 부록 표를 만들지 마라/);
assert.match(POLICY_ANALYSIS_RULE, /인과를 주장하는 동사\(유발했다·때문이다\)를 쓰지 말고/, "인과는 면책 문장이 아니라 동사 선택으로 막는다");
assert.match(POLICY_ANALYSIS_RULE, /"시행 중이다"라고 쓰지 않는다/, "미검증 정책을 시행 중으로 쓰지 않는다");
assert.match(POLICY_ANALYSIS_RULE, /출처 면책 문장은 화면이 따로 표시하므로 본문에 쓰지 않는다/);
assert.match(POLICY_ANALYSIS_RULE, /바로 뒤 괄호에 한국어 내용을 붙인다/);
// 표준 번호 뒤 괄호 설명은 서버가 보장한다.
const { annotatePolicyCodes, policyCodeGlossary } = await import('../lib/policy-context.js');
const glossary = policyCodeGlossary(policies);
assert.equal(annotatePolicyCodes('GB 38031-2025 및 GB18384-2025 시행', glossary), 'GB 38031-2025(동력전지 안전요구 개정) 및 GB18384-2025(전기차 안전요구 개정) 시행');
assert.equal(annotatePolicyCodes('GB 38031-2025(동력전지) 이미 설명', glossary), 'GB 38031-2025(동력전지) 이미 설명', '이미 괄호가 있으면 두지 않는다');
assert.equal(annotatePolicyCodes('GB 38031-2025 동력전지 안전요구 개정은', glossary), 'GB 38031-2025 동력전지 안전요구 개정은', '바로 뒤에 같은 내용을 적었으면 두지 않는다');
assert.equal(annotatePolicyCodes('GB 99999-2025', glossary), 'GB 99999-2025', '모르는 번호는 건드리지 않는다');
const { linkedPolicyTable } = await import('../lib/policy-links.js');
assert.doesNotMatch(linkedPolicyTable([{ policy_id: 'policy-history-18', policy_title: '동력전지 안전요구(개정)', policy_date: '2025-03-28', policy_verification: '원문 독립 미검증', relation: 'direct', path_ko: '경로', basis: [] }], policies), /미검증/, '보고서 입력 표에 검증 표기를 넣지 않는다(모델이 본문에 옮겨 적는다)');

// Execute the visible policy column renderer: period alignment and HTML escaping.
const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function policyInlineItems('), app.indexOf('// 리포트 출력은 제한된 Markdown('));
const escapeHtml = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const { policyCell } = new Function('escapeHtml', 'periodOf', 'displayDate', source + '\nreturn { policyCell };')(escapeHtml, date => date.slice(0, 4), event => event.date);
const fake = [
  { id: 'policy-1', date: '2026-07-16', title: '<script>bad</script>', fact: '발표 내용', sourceName: '첨부 미검증' },
  { id: 'policy-1-schedule-2026-09-01', date: '2026-09-01', title: '<script>bad</script> · 시행·유예 일정(첨부)', fact: '시행 내용', sourceName: '첨부 미검증' },
];
assert.equal(policyCell(fake, '2025'), '');
const inline = policyCell(fake, '2026');
assert.match(inline, /&lt;script&gt;/);
assert.equal((inline.match(/&lt;script&gt;/g) || []).length, 1, '발표·시행 일정이 같은 분기에 겹쳐도 정책은 한 번만 보인다');
assert.doesNotMatch(inline, /시행·유예 일정/, '정책 행 제목에는 중복 일정 꼬리표를 표시하지 않는다');
const linked = policyCell(fake, '2026', new Map([['policy-1', { relation: 'indirect', path_ko: '<b>경로</b>', basis: [{ date: '2025-01-01', title: '사건' }] }]]));
assert.match(linked, /정책 · 간접 연결/, '판정된 연결은 정책 줄에 표시한다');
assert.match(linked, /&lt;b&gt;경로/, '연결 경로도 이스케이프한다');
assert.doesNotMatch(app, /function renderPolicyAxis\(/, '중복되는 전체 정책 목록 렌더러를 두지 않는다');
const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(index, /company-policy-axis|compare-policy-axis|배터리·NEV·ESS 정책 시간축/, '별도 정책 목록 섹션을 렌더하지 않는다');
assert.match(app, /let includePolicy = false/, '정책 한 줄 표시는 기본으로 꺼져 있어야 한다');
assert.match(app, /policy-inline-row/, '정책은 별도 열이 아니라 해당 시점 아래의 보조 행이어야 한다');
assert.match(index, /id="include-policy"/, '기업 화면에서 정책 표시를 선택할 수 있어야 한다');
assert.match(index, /id="include-policy-compare"/, '비교 화면에서 정책 표시를 선택할 수 있어야 한다');
assert.match(app, /includePolicy: includePolicyInReport/, '리포트 생성 시 정책 반영 여부를 서버에 전달해야 한다');
console.log(`policy context checks passed: 35 policies, ${policies.length} dated entries`);
