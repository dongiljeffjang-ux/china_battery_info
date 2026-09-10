// 검색 요청 계획 회귀 검사. API 호출 없음.
// 2026-09-07: 그룹 크기와 기사 상한이 DeepSeek 검색 반복(시간초과)의 직접 원인이었다.
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'test';
process.env.DEEPSEEK_API_KEY = 'test-only';
process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { buildSearchGroups, plannedSearchRequests, TRACKED_COMPANIES } = await import('../lib/china-sources.js');
const { searchBudgetFor } = await import('../lib/ingestion-guard.js');

assert.equal(TRACKED_COMPANIES.length, 26);
assert.deepEqual(
  Object.fromEntries(['cell', 'cathode', 'anode'].map((tag) => [tag, TRACKED_COMPANIES.filter((company) => company.type_tags.includes(tag)).length])),
  { cell: 10, cathode: 11, anode: 5 },
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
assert.equal(planned, buildSearchGroups('openai').length + buildSearchGroups('deepseek').length + 2);
assert.ok(searchBudgetFor(planned).search > planned, 'budget exceeds plan');

// Bootstrap: 검증 기사 0건인 핵심 비상장사(Reshine·Kaijin)를 처음 한 번 365일 단독 검색한다.
// docs/HANDOFF-CODEX.md 2026-09-07 "Reshine 공백" 절 참고.
const bootstrapIds = ['reshine', 'kaijin-new-energy'];
for (const provider of ['openai', 'deepseek']) {
  const withBootstrap = buildSearchGroups(provider, false, bootstrapIds);
  const bootstrapGroups = withBootstrap.filter((g) => g.bootstrap);
  assert.equal(bootstrapGroups.length, bootstrapIds.length, `${provider}: one solo group per bootstrap company`);
  for (const group of bootstrapGroups) {
    assert.deepEqual(group.ids.length, 1, `${provider}: bootstrap group is solo`);
    assert.equal(group.windowDays, 365, `${provider}: bootstrap window is 365 days`);
  }
  const normalIds = new Set(withBootstrap.filter((g) => !g.bootstrap).flatMap((g) => g.ids));
  for (const id of bootstrapIds) assert.ok(!normalIds.has(id), `${provider}: ${id} not duplicated in a normal group`);
  // 기본 호출(bootstrap 없음)은 기존 그룹·예산 그대로다.
  assert.deepEqual(buildSearchGroups(provider, false), buildSearchGroups(provider, false, []));
}
const plannedWithBootstrap = plannedSearchRequests(false, bootstrapIds);
assert.equal(
  plannedWithBootstrap,
  buildSearchGroups('openai', false, bootstrapIds).length + buildSearchGroups('deepseek', false, bootstrapIds).length + 2,
);
assert.ok(plannedWithBootstrap > planned, 'bootstrap adds extra requests');

console.log(`search plan checks passed (planned requests ${planned}, with bootstrap ${plannedWithBootstrap}, budget ${searchBudgetFor(planned).search})`);
