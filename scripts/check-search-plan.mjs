// 검색 요청 계획 회귀 검사. API 호출 없음.
// 2026-09-07: 그룹 크기와 기사 상한이 DeepSeek 검색 반복(시간초과)의 직접 원인이었다.
// 2026-09-12: 검색 레인(openai·china_local)과 엔진을 분리했다. DeepSeek Responses API가 V4.1 Flash
// 전환 뒤 내장 web_search 도구를 무시해 중국 현지 레인의 기본 엔진이 OpenAI다.
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'test';
process.env.DEEPSEEK_API_KEY = 'test-only';
delete process.env.CHINA_LOCAL_SEARCH_ENGINE;
process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { buildSearchGroups, plannedSearchRequests, TRACKED_COMPANIES, SEARCH_LANES, searchLaneEngine, policySearchEngines, searchProviderPrompt } = await import('../lib/china-sources.js');
const { searchBudgetFor } = await import('../lib/ingestion-guard.js');

assert.equal(TRACKED_COMPANIES.length, 26);
assert.deepEqual(
  Object.fromEntries(['cell', 'cathode', 'anode'].map((tag) => [tag, TRACKED_COMPANIES.filter((company) => company.type_tags.includes(tag)).length])),
  { cell: 10, cathode: 11, anode: 5 },
);

// 레인 → 엔진. 기본은 두 레인 모두 OpenAI, 정책 검색은 엔진마다 1회라 기본 1회다.
assert.deepEqual(SEARCH_LANES, ['openai', 'china_local']);
assert.equal(searchLaneEngine('openai'), 'openai');
assert.equal(searchLaneEngine('china_local'), 'openai', 'china_local lane defaults to the OpenAI engine');
assert.equal(searchLaneEngine('deepseek'), 'deepseek', 'engine names pass through for diagnostics');
assert.deepEqual(policySearchEngines(), ['openai'], 'policy search runs once per distinct engine');
process.env.CHINA_LOCAL_SEARCH_ENGINE = 'deepseek';
assert.equal(searchLaneEngine('china_local'), 'deepseek', 'CHINA_LOCAL_SEARCH_ENGINE=deepseek re-enables the DeepSeek engine without a deploy');
assert.deepEqual(policySearchEngines(), ['openai', 'deepseek']);
assert.ok(buildSearchGroups('china_local', false).every((g) => g.ids.length <= 3), 'DeepSeek engine keeps the smaller group size');
assert.match(searchProviderPrompt('china_local'), /회사마다 검색 1회씩만/, 'DeepSeek engine keeps the call-count guard in the prompt');
process.env.CHINA_LOCAL_SEARCH_ENGINE = 'bogus';
assert.equal(searchLaneEngine('china_local'), 'openai', 'unknown engine names fall back to OpenAI');
delete process.env.CHINA_LOCAL_SEARCH_ENGINE;
assert.doesNotMatch(searchProviderPrompt('china_local'), /회사마다 검색 1회씩만/, 'OpenAI engine does not carry the DeepSeek call-count guard');
assert.match(searchProviderPrompt('china_local'), /중국어/, 'china_local lane still asks for Chinese local sources');

for (const lane of SEARCH_LANES) {
  const groups = buildSearchGroups(lane, false);
  const max = searchLaneEngine(lane) === 'deepseek' ? 3 : 4;
  assert.ok(groups.every((g) => g.ids.length >= 1 && g.ids.length <= max), `${lane} group size ≤ ${max}`);
  const covered = new Set(groups.flatMap((g) => g.ids));
  for (const company of TRACKED_COMPANIES) if (['cell','cathode','anode'].some((t) => company.type_tags.includes(t))) assert.ok(covered.has(company.id), `${company.id} covered by ${lane}`);
}
const pilot = buildSearchGroups('china_local', true);
assert.deepEqual(new Set(pilot.flatMap((g) => g.ids)), new Set(['catl', 'hunan-yuneng', 'btr']));

const planned = plannedSearchRequests(false);
assert.equal(planned, buildSearchGroups('openai').length + buildSearchGroups('china_local').length + policySearchEngines().length);
assert.ok(searchBudgetFor(planned).search > planned, 'budget exceeds plan');

// Bootstrap: 검증 기사 0건인 핵심 비상장사(Reshine·Kaijin)를 처음 한 번 365일 단독 검색한다.
// docs/HANDOFF-CODEX.md 2026-09-07 "Reshine 공백" 절 참고.
const bootstrapIds = ['reshine', 'kaijin-new-energy'];
for (const lane of SEARCH_LANES) {
  const withBootstrap = buildSearchGroups(lane, false, bootstrapIds);
  const bootstrapGroups = withBootstrap.filter((g) => g.bootstrap);
  assert.equal(bootstrapGroups.length, bootstrapIds.length, `${lane}: one solo group per bootstrap company`);
  for (const group of bootstrapGroups) {
    assert.deepEqual(group.ids.length, 1, `${lane}: bootstrap group is solo`);
    assert.equal(group.windowDays, 365, `${lane}: bootstrap window is 365 days`);
  }
  const normalIds = new Set(withBootstrap.filter((g) => !g.bootstrap).flatMap((g) => g.ids));
  for (const id of bootstrapIds) assert.ok(!normalIds.has(id), `${lane}: ${id} not duplicated in a normal group`);
  // 기본 호출(bootstrap 없음)은 기존 그룹·예산 그대로다.
  assert.deepEqual(buildSearchGroups(lane, false), buildSearchGroups(lane, false, []));
}
const plannedWithBootstrap = plannedSearchRequests(false, bootstrapIds);
assert.equal(
  plannedWithBootstrap,
  buildSearchGroups('openai', false, bootstrapIds).length + buildSearchGroups('china_local', false, bootstrapIds).length + policySearchEngines().length,
);
assert.ok(plannedWithBootstrap > planned, 'bootstrap adds extra requests');

console.log(`search plan checks passed (planned requests ${planned}, with bootstrap ${plannedWithBootstrap}, budget ${searchBudgetFor(planned).search})`);
