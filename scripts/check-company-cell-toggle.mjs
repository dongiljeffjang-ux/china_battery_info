import fs from 'node:fs';

const app = fs.readFileSync('app/app.js', 'utf8');
const css = fs.readFileSync('app/styles.css', 'utf8');

// 검사할 파일을 항목마다 적는다. 예전에는 배열 인덱스로 골랐는데, 항목을 하나 빼면 뒤 항목이
// 엉뚱한 파일을 보게 된다.
const checks = [
  ['matrix preview limit', /const MATRIX_PREVIEW\s*=\s*4/, app],
  ['low-signal workforce rule', /연구인력 구성/, app],
  ['importance sorting', /sort\(\(x, y\) => matrixImportanceOf\(y\) - matrixImportanceOf\(x\)\)/, app],
  ['collapsed matrix items', /class="matrix-items matrix-more" hidden/, app],
  ['accessible toggle state', /class="matrix-toggle" aria-expanded="false"/, app],
  ['toggle handler', /querySelectorAll\('\.matrix-toggle'\)/, app],
  ['toggle styling', /\.matrix-toggle\{/, css]
];
const failures = checks.filter(([, pattern, source]) => !pattern.test(source));
if (failures.length) {
  console.error(`company cell toggle check failed: ${failures.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log(`company cell toggle check passed (${checks.length} checks)`);
