import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POLICY_HISTORY } from '../lib/policy-history.js';
import { historicalPolicies, policyEvidenceText } from '../lib/policy-context.js';
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
assert.ok(input.includes(policyEvidenceText(policies)));
assert.match(input, /원문 독립 검증 완료 사실이 아니다/);

// Execute the actual UI policy renderers: period alignment and HTML escaping.
const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function policyCell('), app.indexOf('// 리포트 출력은 제한된 Markdown('));
const escapeHtml = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const { policyCell, renderPolicyAxis } = new Function('escapeHtml', 'periodOf', 'displayDate', 'sourceLink', source + '\nreturn { policyCell, renderPolicyAxis };')(escapeHtml, date => date.slice(0, 4), event => event.date, event => escapeHtml(event.sourceName));
const fake = [{ date: '2026-09-01', title: '<script>bad</script>', fact: '시행 내용', sourceName: '첨부 미검증' }];
assert.equal(policyCell(fake, '2025'), '—');
assert.match(policyCell(fake, '2026'), /&lt;script&gt;/);
const target = { innerHTML: '' };
renderPolicyAxis(target, fake);
assert.ok(target.innerHTML.includes('시행 내용'));
assert.ok(!target.innerHTML.includes('<script>'));
renderPolicyAxis(target, []);
assert.ok(!target.innerHTML.includes('시행 내용'));
console.log(`policy context checks passed: 35 policies, ${policies.length} dated entries`);
