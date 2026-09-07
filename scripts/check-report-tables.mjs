// 보고서 표 추출·청킹 회귀 검사. 네트워크·API 호출 없음.
// 2026-09-08: 표가 join("")로 뭉개져 헤더가 떨어져 나가던 문제를 고친 뒤 그 동작을 고정한다.
import assert from 'node:assert/strict';
const { pageToLines } = await import('../lib/report-reader.js');
const { chunkStructuredText } = await import('../lib/vector-ingestion.js');

// pdfjs가 주는 모양을 흉내낸다. transform[4]=x, transform[5]=y, width=글자 폭.
const it = (str, x, y, width) => ({ str, width: width ?? str.length * 6, transform: [1, 0, 0, 1, x, y] });

// 1) 표 행: 간격이 여러 번 벌어지고 숫자가 있으면 셀을 파이프로 나눈다.
const table = pageToLines([
  it('项目', 50, 500), it('2025年', 200, 500), it('2024年', 300, 500), it('2023年', 400, 500),
  it('营业收入', 50, 482), it('423,701,834', 200, 482), it('362,012,554', 300, 482), it('400,917,045', 400, 482),
]);
assert.equal(table.split('\n')[0], '项目 | 2025年 | 2024年 | 2023年');
assert.equal(table.split('\n')[1], '营业收入 | 423,701,834 | 362,012,554 | 400,917,045');

// 2) 산문과 표제에는 파이프를 넣지 않는다. 숫자가 없으면 표로 보지 않는다.
assert.equal(pageToLines([it('五、主要会计数据和财务指标', 50, 578)]), '五、主要会计数据和财务指标');
assert.equal(pageToLines([it('공급', 50, 500), it('계약', 200, 500), it('체결', 400, 500)]), '공급계약체결');

// 3) y가 1~2pt 흔들려도 같은 줄로 묶는다.
assert.equal(pageToLines([it('가', 50, 500), it('나', 70, 501)]), '가나');

// 4) 행이 서로 붙지 않는다. 예전에는 join("")이라 앞 행 숫자와 다음 행 이름이 한 덩어리였다.
assert.ok(!table.includes('400,917,045营业收入'));

// 5) 청킹: 표가 여러 청크에 걸치면 청크마다 헤더가 다시 붙는다.
const header = 'A | B | C';
const rows = Array.from({ length: 400 }, (_, i) => `행${i} | ${i}00 | ${i}11`);
const chunks = chunkStructuredText([header, ...rows].join('\n'), 50);
assert.ok(chunks.length > 1, '여러 청크로 나뉜다');
for (const chunk of chunks) assert.ok(chunk.startsWith(header), '모든 표 청크가 헤더로 시작한다');

// 6) 표 행은 중간에서 쪼개지지 않는다.
for (const chunk of chunks) for (const line of chunk.split('\n')) {
  if (line === header) continue;
  assert.match(line, /^행\d+ \| \d+00 \| \d+11$/, `행이 온전하다: ${line}`);
}

// 7) 산문은 줄 단위로 담기고 헤더가 붙지 않는다.
const prose = chunkStructuredText(['문단 하나.', '문단 둘.', '문단 셋.'].join('\n'), 50);
assert.equal(prose.length, 1);
assert.equal(prose[0], '문단 하나.\n문단 둘.\n문단 셋.');

console.log('보고서 표 추출·청킹 검사 통과 (네트워크 없음)');
