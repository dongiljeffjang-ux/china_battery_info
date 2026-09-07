// 보고서 표 추출·청킹 회귀 검사. 네트워크·API 호출 없음.
// 2026-09-08: 표가 join("")로 뭉개져 헤더가 떨어져 나가던 문제를 고친 뒤 그 동작을 고정한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { pageToLines, splitGluedCells, annotateTableUnits, renderTableRows } = await import('../lib/report-reader.js');
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

// 8) 붙은 셀을 뗀다. 간격이 6pt보다 좁아 pdfjs 조각이 한 덩어리로 왔을 때(저장된 보고서 5건에서
//    줄당 43~154번). 항목명+금액, 금액+금액, 금액+항목명 세 가지 모양.
assert.equal(splitGluedCells('孚能镇江 | 全资子公司114,252.25 | 2023/3/22'), '孚能镇江 | 全资子公司 | 114,252.25 | 2023/3/22');
assert.equal(splitGluedCells('合计1,417,709,525.3530,302,917.961,387,406,607.39'), '合计 | 1,417,709,525.35 | 30,302,917.96 | 1,387,406,607.39');
assert.equal(splitGluedCells('3,740,829,575.45 2,253,835,528.82抵押4,341,450,584.71'), '3,740,829,575.45 2,253,835,528.82 | 抵押 | 4,341,450,584.71');
// 숫자에 붙은 단위(万元·欧元·港币·股)는 한 셀이다. 가르지 않는다.
assert.equal(splitGluedCells('孚能科技（镇江）有限公司 | 镇江 | 451,404.49万元 | 镇江'), '孚能科技（镇江）有限公司 | 镇江 | 451,404.49万元 | 镇江');
assert.equal(splitGluedCells('注册资本 | 25,000.00欧元 | 1港币 | 10,000,000股'), '注册资本 | 25,000.00欧元 | 1港币 | 10,000,000股');
// 산문의 연도·순번은 천단위 쉼표가 없어 건드리지 않는다.
assert.equal(splitGluedCells('2023年第3季度实现营业收入4.5亿元'), '2023年第3季度实现营业收入4.5亿元');
// 간격이 좁아 표로 못 알아본 줄도 천단위 숫자가 셋 이상이면 뗀다.
const glued = pageToLines([it('合计', 50, 400, 12), it('1,417,709,525.35', 62, 400, 60), it('30,302,917.96', 122, 400, 50), it('1,387,406,607.39', 172, 400, 60)]);
assert.equal(glued, '合计 | 1,417,709,525.35 | 30,302,917.96 | 1,387,406,607.39');

// 9) 단위 머리가 뒤따르는 표 행에 같이 다닌다. 다음 단위 머리나 절 제목에서 끊긴다.
const annotated = annotateTableUnits([
  '担保情况 单位：万元 币种：人民币',
  '孚能镇江 | 全资子公司 | 114,252.25 | 2023/3/22',
  '本报告期内担保总额较大。',
  '孚能镇江 | 全资子公司 | 67,500.00 | 2025/8/12',
  '单位：元',
  '营业成本 | 5,700,840,306.84 | 7,500,105,744.27',
  '第四节 公司治理',
  '项目 | 2025年 | 2024年',
].join('\n')).split('\n');
assert.equal(annotated[1], '孚能镇江 | 全资子公司 | 114,252.25 | 2023/3/22 [单位:万元]');
assert.equal(annotated[2], '本报告期内担保总额较大。', '산문에는 붙이지 않는다');
assert.equal(annotated[3], '孚能镇江 | 全资子公司 | 67,500.00 | 2025/8/12 [单位:万元]');
assert.equal(annotated[5], '营业成本 | 5,700,840,306.84 | 7,500,105,744.27 [单位:元]', '새 단위 머리로 바뀐다');
assert.equal(annotated[7], '项目 | 2025年 | 2024年', '절이 바뀌면 단위를 잊는다');

// 10) 표 행을 문장으로 편다: 표 이름 · 행 이름: 열 값, … (단위). 줄글은 그대로 둔다.
const rendered = renderTableRows(annotateTableUnits([
  '本报告期内公司为子公司提供担保情况如下。',
  '担保情况 单位：万元 币种：人民币',
  '被担保方 | 关系 | 担保金额 | 发生日期 | 是否履行完毕',
  '孚能镇江 | 全资子公司 | 114,252.25 | 2023/3/22 | 否',
  '孚能镇江 | 全资子公司 | 67,500.00 | 2025/8/12 | 否',
  '合计 | | 181,752.25',
  '会员卡按月计费，中途退卡不予退款。',
].join('\n'))).split('\n');
assert.equal(rendered[0], '本报告期内公司为子公司提供担保情况如下。', '줄글은 손대지 않는다');
assert.equal(rendered[2], '被担保方 | 关系 | 担保金额 | 发生日期 | 是否履行完毕', '헤더 행은 남긴다');
assert.equal(rendered[3], '担保情况 · 孚能镇江: 关系 全资子公司, 担保金额 114,252.25, 发生日期 2023/3/22, 是否履行完毕 否 (单位:万元)');
assert.equal(rendered[4], '担保情况 · 孚能镇江: 关系 全资子公司, 担保金额 67,500.00, 发生日期 2025/8/12, 是否履行完毕 否 (单位:万元)');
assert.equal(rendered[5], '合计 | | 181,752.25 [单位:万元]', '열 수가 안 맞는 행은 파이프 그대로');
assert.equal(rendered[6], '会员卡按月计费，中途退卡不予退款。', '표 뒤 줄글도 그대로');
// 첫 행이 숫자 위주면 헤더가 없는 표다. 문장으로 펴지 않는다.
assert.equal(renderTableRows('1,000 | 2,000 | 3,000\n4,000 | 5,000 | 6,000'), '1,000 | 2,000 | 3,000\n4,000 | 5,000 | 6,000');
// 11) 실제 보고서 모양: 여러 줄로 감싼 헤더는 y좌표 묶기에 흩어져 파이프 행으로 남지 않고,
//     첫 파이프 행이 데이터 행이다. 금액·날짜가 있는 첫 행을 헤더로 잡으면 뒤 행이 엉뚱한 문장이 된다.
const noHeader = renderTableRows(annotateTableUnits([
  '单位：万元 币种：人民币',
  '担保方与被担保方与担保是否担保担保是否存',
  '公司 | 公司本部 | 孚能镇江 | 全资子公司 | 230,000.00 | 2021/10/15 | 2030/10/15连带责任担保 | 否',
  '公司 | 公司本部 | 孚能镇江 | 全资子公司 | 150,000.00 | 2024/12/25 | 主债务到期之日起3年 连带责任担保 | 是',
].join('\n'))).split('\n');
assert.equal(noHeader[2], '公司 | 公司本部 | 孚能镇江 | 全资子公司 | 230,000.00 | 2021/10/15 | 2030/10/15连带责任担保 | 否 [单位:万元]', '데이터 행을 헤더로 잡지 않고 파이프 그대로 둔다');
assert.equal(noHeader[3], '公司 | 公司本部 | 孚能镇江 | 全资子公司 | 150,000.00 | 2024/12/25 | 主债务到期之日起3年 连带责任担保 | 是 [单位:万元]');
// 셀 안에 단위가 붙은 금액(451,404.49万元)이 있는 첫 행도 헤더가 아니다.
const subs = renderTableRows('孚能科技（镇江）有限公司 | 镇江 | 451,404.49万元 | 镇江 | 100 | - | 出资设立\nFarasis Energy Europe GmbH | 德国 | 25,000欧元 | 德国 | - | 100 | 出资设立').split('\n');
assert.ok(subs[1].includes(' | '), '금액 셀이 있는 첫 행을 헤더로 잡지 않는다');

const readerSource = fs.readFileSync(new URL('../lib/report-reader.js', import.meta.url), 'utf8');
assert.match(readerSource, /renderTableRows\(annotateTableUnits\(text\)\)/, 'extractPdfText가 단위 주석 뒤 표 행을 문장으로 펴야 한다');
assert.match(readerSource, /getOperatorList\(\)/, 'PDF 이미지 연산 목록을 검사해야 한다');
assert.match(readerSource, /visual_review_required/, '큰 이미지 페이지는 시각 검토 대상으로 표시해야 한다');

console.log('보고서 표 추출·청킹·이미지 감지 검사 통과 (네트워크 없음)');
