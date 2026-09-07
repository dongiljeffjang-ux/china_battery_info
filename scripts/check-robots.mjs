// robots.txt 해석 회귀 검사. 네트워크·API 호출 없음.
import assert from 'node:assert/strict';
const { _internal } = await import('../lib/robots.js');
const { parseRobots, pickGroup, isAllowed } = _internal;

const groups = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/public-note
Crawl-delay: 2

User-agent: ChinaBatteryLens
Disallow: /nope/
`);
const generic = groups.find((g) => g.agents.includes('*'));
assert.equal(generic.delayMs, 2000, 'crawl-delay seconds → ms');

// 이름을 지목한 그룹이 '*'보다 우선한다.
const mine = pickGroup(groups);
assert.deepEqual(mine.disallow, ['/nope/'], 'named group wins over *');
assert.equal(isAllowed(mine, '/private/anything'), true, 'named group does not inherit * rules');
assert.equal(isAllowed(mine, '/nope/x'), false);

// 가장 긴 규칙이 이기고, 같은 길이면 Allow가 이긴다.
assert.equal(isAllowed(generic, '/private/secret'), false);
assert.equal(isAllowed(generic, '/private/public-note'), true, 'longer Allow beats shorter Disallow');
assert.equal(isAllowed(generic, '/news/1'), true);

// 와일드카드와 종료 앵커.
const wild = pickGroup(parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b'));
assert.equal(isAllowed(wild, '/x/y.pdf'), false);
assert.equal(isAllowed(wild, '/x/y.pdfx'), true, '$ anchors the end');
assert.equal(isAllowed(wild, '/a/mid/b'), false);

// 규칙이 없으면 모두 허용.
assert.equal(isAllowed(pickGroup(parseRobots('')), '/anything'), true);
// 주석과 빈 줄을 무시한다.
assert.equal(isAllowed(pickGroup(parseRobots('# hi\nUser-agent: *\n\nDisallow: /x # tail')), '/x'), false);

console.log('robots.txt parsing and allow/deny precedence checks passed (no network)');
