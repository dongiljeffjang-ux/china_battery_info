// 검색 요청 계획 회귀 검사. API 호출 없음.
// 2026-09-07: 그룹 크기와 기사 상한이 DeepSeek 검색 반복(시간초과)의 직접 원인이었다.
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'test';
process.env.DEEPSEEK_API_KEY = 'test-only';
process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { buildSearchGroups, plannedSearchRequests, TRACKED_COMPANIES } = await import('../lib/china-sources.js');
const { searchBudgetFor } = await import('../lib/ingestion-guard.js');

assert.equal(TRACKED_COMPANIES.length, 25);
assert.deepEqual(
  Object.fromEntries(['cell', 'cathode', 'anode'].map((tag) => [tag, TRACKED_COMPANIES.filter((company) => company.type_tags.includes(tag)).length])),
  { cell: 10, cathode: 10, anode: 5 },
);

for (const provider of ['openai', 'deepseek']) {
  const groups = buildSearchGroups(provider, false);
  const max = provider === 'deepseek' ? 3 : 4;
  assert.ok(groups.every((g) => g.ids.length >= 1 && g.ids.length <= max), `${provider} group size ≤ ${max}`);
  const covered = new Set(groups.flatMap((g) => g.ids));
  for (const company of TRACKED_COMPANIES) if (['cell','cathode','anode'].some((t) => company.type_tags.includes(t))) assert.ok(covered.has(company.id), `${company.id} covered by ${provider}`);
}
const pilot = buildSearchGroups('deepseek', true);
assert.deepEqual(new Set(pilot.flatMap((g) => g.ids)), new Set(['catl', 'hunan-yuneng', 'btr']));

const planned = plannedSearchRequests(false);
assert.equal(planned, buildSearchGroups('openai').length + buildSearchGroups('deepseek').length);
assert.ok(searchBudgetFor(planned).search > planned, 'budget exceeds plan');
console.log(`search plan checks passed (planned requests ${planned}, budget ${searchBudgetFor(planned).search})`);
