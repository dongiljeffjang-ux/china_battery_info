import fs from 'node:fs';

const app = fs.readFileSync('app/app.js', 'utf8');
const html = fs.readFileSync('app/index.html', 'utf8');
const css = fs.readFileSync('app/styles.css', 'utf8');

const checks = [
  ['matrix preview limit', /const MATRIX_PREVIEW\s*=\s*4/],
  ['low-signal workforce rule', /연구인력 구성/],
  ['importance sorting', /sort\(\(x, y\) => matrixImportanceOf\(y\) - matrixImportanceOf\(x\)\)/],
  ['collapsed matrix items', /class="matrix-items matrix-more" hidden/],
  ['accessible toggle state', /class="matrix-toggle" aria-expanded="false"/],
  ['toggle handler', /querySelectorAll\('\.matrix-toggle'\)/],
  ['cache-busted asset', /app\.js\?v=20260914-matrix-toggle/],
  ['toggle styling', /\.matrix-toggle\{/]
];
const failures = checks.filter(([, pattern]) => !pattern.test(pattern === checks[6]?.[1] ? html : pattern === checks[7]?.[1] ? css : app));
if (failures.length) {
  console.error(`company cell toggle check failed: ${failures.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log(`company cell toggle check passed (${checks.length} checks)`);
