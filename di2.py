# -*- coding: utf-8 -*-
import io

p = 'app/app.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, why=''):
    global s
    assert old in s, f'못 찾음({why}): {old[:90]!r}'
    s = s.replace(old, new, 1)


rep("let dailyReportFacts = null;", "let dailyReportFacts = null;\nlet dailyReportInsight = null;", 'state')

rep("""    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\\n+/).filter(Boolean);
    }""",
"""    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\\n+/).filter(Boolean);
    }
    dailyReportInsight = payload.report?.insight_ko ? payload.report.insight_ko.split(/\\n+/).filter(Boolean) : null;""",
    'load')

rep("""  target.innerHTML = sections.map(section => {
    const chip = section.category
      ? `<p class="summary-cat ${summaryCategoryClass[section.category] || ''}">${escapeHtml(section.category)}</p>`
      : '';
    return `<div class="summary-block">${chip}<ul>${section.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul></div>`;
  }).join('');
}""",
"""  target.innerHTML = sections.map(section => {
    const chip = section.category
      ? `<p class="summary-cat ${summaryCategoryClass[section.category] || ''}">${escapeHtml(section.category)}</p>`
      : '';
    return `<div class="summary-block">${chip}<ul>${section.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul></div>`;
  }).join('');
  renderDailyInsight();
}

// 해석은 사실이 아니다. prd.md의 "사실, 해석, 추정을 구분한다"에 따라 영역을 나누고
// 근거가 된 사실을 항목마다 같이 보여준다.
function renderDailyInsight(){
  const target = document.querySelector('#daily-insight');
  if (!target) return;
  const sections = parseDailySections(dailyReportInsight || []);
  if (!sections.length) { target.innerHTML = ''; return; }
  const body = sections.map(section => {
    const items = section.points.map(point => {
      const basis = point.match(/^근거:\\s*(.+)$/);
      if (basis) return `<li class="insight-basis">${escapeHtml(basis[1])}</li>`;
      const segment = point.match(/^\\[([^\\]]+)\\]\\s*(.+)$/);
      return segment
        ? `<li><span class="insight-seg">${escapeHtml(segment[1])}</span>${escapeHtml(segment[2])}</li>`
        : `<li>${escapeHtml(point)}</li>`;
    }).join('');
    return `<div class="summary-block">${section.category ? `<p class="summary-cat insight">${escapeHtml(section.category)}</p>` : ''}<ul>${items}</ul></div>`;
  }).join('');
  target.innerHTML = `<div class="insight-head"><p class="eyebrow">INSIGHT</p><h3>한국 배터리사·소재사에 주는 의미</h3><span class="source-rule">사실이 아니라 해석입니다</span></div>${body}`;
}""", 'render')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('app.js ok')

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()
old = '          <div id="daily-summary-list" class="summary-list"></div>'
assert old in s, 'daily list'
s = s.replace(old, old + '\n          <section id="daily-insight" class="daily-insight"></section>', 1)
s = s.replace('./app.js?v=20260902-compact-matrix', './app.js?v=20260902-daily-insight', 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('index.html ok')

p = 'app/styles.css'
s = io.open(p, encoding='utf-8').read()
assert '.daily-insight' not in s
s = s.rstrip('\n') + (
    '.daily-insight{margin-top:22px;padding:18px 20px;border:1px solid #e4dcc8;border-radius:11px;background:#fffdf6;display:grid;gap:14px}'
    '.daily-insight:empty{display:none}'
    '.insight-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}'
    '.insight-head .eyebrow{color:var(--tech);margin:0}'
    '.insight-head h3{margin:0;font-size:16px}'
    '.insight-head .source-rule{margin-left:auto;background:var(--tech-bg);color:var(--tech)}'
    '.summary-cat.insight{background:var(--tech-bg);color:var(--tech)}'
    '.insight-seg{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:800;background:#fff;border:1px solid #e4dcc8;color:var(--tech)}'
    '.insight-basis{color:var(--muted);font-size:11px}'
    '.insight-basis::before{background:#d8c9a4}\n'
)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('styles.css ok')
