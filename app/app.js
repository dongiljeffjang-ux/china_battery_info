const valueChainLabels = { cell: '셀사', cathode: '양극재', anode: '음극재' };
// 헤드라인 흐름도에 한 번에 세울 기업 수. 넘으면 출하 순위 상위만 남기고 나머지는 안내문으로 알린다.
const SANKEY_COMPANY_LIMIT = 12;
// 밸류체인별 표식 색. 파랑·보라·주황 세 계열로 갈라 한눈에 구분되게 한다.
// 흐름도 링크가 초록(확대)·빨강(축소)을 쓰므로 그 두 색은 피한다.
const CHAIN_COLORS = { cell: '#10365f', cathode: '#5b3d94', anode: '#7d5010' };
const CHAIN_BG = { cell: '#cfe0f2', cathode: '#e2d9f3', anode: '#f7e3c4' };
const marketLayerLabels = {
  'supply-performance': '수급·사업성과',
  'investment-production': '투자·생산기반',
  'customer-commercialization': '고객·상업화',
  'regional-overseas': '지역·해외전략'
};
const technologyLayerLabels = {
  'technology-material-chemistry': '소재·화학계',
  'technology-process-performance': '공정·성능',
  'technology-ip-standard': 'IP·표준',
  'technology-development': '개발·인증·양산'
};
const layerLabels = { ...marketLayerLabels, ...technologyLayerLabels };
const UNCLASSIFIED_LAYER = 'unclassified';
const EMPTY_CELL_NOTE = '확인된 이벤트 없음';

// 회사 마스터와 기업 시계열은 /api/company에서만 받는다. 화면에 시드 데이터를 두지 않는다.
let companyCatalog = [];
const companyTimelineCache = new Map();
let currentCompany = '';
let currentNewsValueChain = 'cell';
let currentNewsCompany = 'all';
let dailyReportFacts = null;
let dailyReportInsight = null;
let approvedTop10 = [];
let approvedCompanyNews = [];
let rangeFlows = [];
// 같은 소식이라 한 번만 센 미검증 헤드라인 수(서버가 셈). Sankey 안내 문구에 쓴다.
let rangeHeadlineDuplicates = 0;
let lastComparison = null;
// 기업 시계열 리포트는 비교 리포트와 달리 저장하지 않는다. 현재 화면에 표시된 근거만 이 메모리에 둔다.
let lastCompanyTimeline = null;
const TOP_NEWS_PREVIEW = 4;
let topNewsExpanded = false;

function companyById(id){ return companyCatalog.find(company => company.id === id) || null; }
function displayName(id){ return companyById(id)?.name_ko || id; }
function companiesInValueChain(chain){ return companyCatalog.filter(company => company.value_chain === chain); }
let tipElement = null;
function tooltipNode(){
  if (!tipElement) {
    tipElement = document.createElement('div');
    tipElement.className = 'hover-tip';
    tipElement.hidden = true;
    document.body.append(tipElement);
  }
  return tipElement;
}
function showTip(text, x, y){
  const tip = tooltipNode();
  tip.textContent = text;
  tip.hidden = false;
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  const left = Math.min(Math.max(pad, x + 16), window.innerWidth - rect.width - pad);
  const top = y + rect.height + 24 > window.innerHeight ? y - rect.height - 12 : y + 18;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(pad, top)}px`;
}
function hideTip(){ if (tipElement) tipElement.hidden = true; }
document.addEventListener('mouseover', event => {
  const host = event.target.closest?.('[data-tip]');
  if (host) showTip(host.getAttribute('data-tip'), event.clientX, event.clientY);
});
document.addEventListener('mousemove', event => {
  const host = event.target.closest?.('[data-tip]');
  if (host) showTip(host.getAttribute('data-tip'), event.clientX, event.clientY);
  else hideTip();
});
document.addEventListener('mouseleave', hideTip);
// 키보드 접근성: data-tip 요소에 포커스가 오면 그 위치에 툴팁을 띄운다.
document.addEventListener('focusin', event => {
  const host = event.target.closest?.('[data-tip]');
  if (!host) return;
  const rect = host.getBoundingClientRect();
  showTip(host.getAttribute('data-tip'), rect.left, rect.bottom + 6);
});
document.addEventListener('focusout', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

// ── 전체 화면 진행 표시 ──────────────────────────────────────────
// 수집·분석처럼 수십 초 이상 걸리는 작업 중에는 다른 조작을 막고 진행 상황을 보여준다.
function busyNode(){
  let overlay = document.querySelector('#busy-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'busy-overlay';
    overlay.className = 'busy-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="busy-card" role="status" aria-live="polite"><div class="busy-orbit"><span></span><span></span><span></span></div><p class="busy-title"></p><p class="busy-note"></p><p class="busy-warn">창을 닫거나 새로고침하면 중단됩니다.</p></div>';
    document.body.append(overlay);
  }
  return overlay;
}
function showBusy(title, note = ''){
  const overlay = busyNode();
  overlay.querySelector('.busy-title').textContent = title;
  overlay.querySelector('.busy-note').textContent = note;
  overlay.hidden = false;
  document.body.classList.add('is-busy');
}
function updateBusy(note){
  const overlay = document.querySelector('#busy-overlay');
  if (overlay && !overlay.hidden) overlay.querySelector('.busy-note').textContent = note;
}
function hideBusy(){
  const overlay = document.querySelector('#busy-overlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('is-busy');
}

function escapeHtml(value){ return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const summaryCategoryClass = { '셀': 'cell', '양극재': 'cathode', '음극재': 'anode', '정책·공급망': 'policy' };

// 요약 문장 속 수치는 훑어볼 때 가장 먼저 눈에 들어와야 하는 정보라 굵게 강조한다.
const METRIC_UNITS = ['GWh', 'MWh', 'kWh', '%p', '만톤', '조원', '억원', '만원', '위안', '%', '톤', '원', '배', '위'];
const METRIC_PATTERN = new RegExp(`(\\d[\\d,.]*\\s?(?:${METRIC_UNITS.map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
function highlightMetrics(text){ return escapeHtml(text).replace(METRIC_PATTERN, '<strong>$1</strong>'); }
// Daily 요약 항목은 "회사명, 사실 - 수치" 형식으로 생성되므로 회사명만 앞에서 따로 굵게 표시한다.
function formatSummaryPoint(point){
  // 같은 회사 사실은 한 항목으로 합쳐 "주체 — 사실" 형태로 내려온다. 주체만 앞에서 굵게 뗀다.
  const dash = point.indexOf(' — ');
  if (dash > 0 && dash <= 24) {
    return `<strong class="pt-company">${escapeHtml(point.slice(0, dash))}</strong><span class="pt-fact">${highlightMetrics(point.slice(dash + 3))}</span>`;
  }
  const commaIndex = point.indexOf(',');
  if (commaIndex > 0 && commaIndex <= 18) {
    return `<strong class="pt-company">${escapeHtml(point.slice(0, commaIndex))}</strong>${highlightMetrics(point.slice(commaIndex))}`;
  }
  return highlightMetrics(point);
}

// 기사 팩트 요약도 개조식("- 항목")으로 내려온다. 카테고리 헤더가 없을 뿐 파싱 방식은 같다.
// 개조식 이전에 저장된 옛 기사는 줄바꿈 없는 문장 하나로 오는데, 이때도 한 줄짜리 항목으로 그냥 보여준다.
// 서술형으로 저장된 예전 요약도 카드에서는 개조식으로 보여야 한다.
// 불릿 표시가 없는 문단은 문장 단위로 잘라 한 줄씩 만든다. 소수점(22.99)은 뒤에 공백이 없어 안 잘린다.
function splitSentences(text){
  return String(text).split(/(?<=[.。!?！？])\s+/).map(part => part.trim()).filter(part => part.length > 1);
}
function renderFactHtml(text){
  const lines = String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  const hasBullets = lines.some(line => /^[-*·•]\s+/.test(line));
  const points = hasBullets
    ? parseDailySections(lines).flatMap(section => section.points)
    : lines.flatMap(splitSentences);
  if (!points.length) return '';
  return `<ul class="fact-list">${points.map(point => `<li>${formatSummaryPoint(point)}</li>`).join('')}</ul>`;
}

// Daily 리포트는 "## 카테고리" 다음에 "- 항목"이 오는 형식으로 저장된다.
// 형식이 없는 예전 리포트는 카테고리 없는 한 덩어리로 표시한다.
function parseDailySections(lines){
  const sections = [];
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    const header = line.match(/^#{1,6}\s*(.+)$/);
    if (header) { sections.push({ category: header[1].trim(), points: [] }); continue; }
    const point = line.replace(/^[-*·•]\s+/, '').trim();
    if (!point) continue;
    if (!sections.length) sections.push({ category: '', points: [] });
    sections[sections.length - 1].points.push(point);
  }
  return sections.filter(section => section.points.length);
}
function renderDailySummary(){
  const target = document.querySelector('#daily-summary-list');
  const factSections = parseDailySections(dailyReportFacts || []);
  const industrySection = parseDailySections(dailyReportInsight || []).find(section => ['산업 총평', '오늘의 그림'].includes(section.category));
  if (!factSections.length && !industrySection?.points?.length) {
    target.innerHTML = '<p class="summary-empty">아직 생성된 Daily Report가 없습니다. 수집·분석 1회 실행 후 Top 10 본문 분석 결과와 통합 리포트가 이 영역에 표시됩니다.</p>';
    renderDailyInsight();
    return;
  }
  // 총평(해석) → 사실 → 한국 소재사 관점(해석)을 한 리포트의 번호 붙은 부분으로 이어 둔다.
  // 번호는 CSS 카운터가 매겨, 총평이 없는 날에도 01부터 이어진다.
  const industry = industrySection?.points?.length
    ? `<div class="report-part part-overview">${dailyPartHead('산업 총평', 'interp', '해석 · 아래 사실들을 잇는 산업 차원의 읽기')}<div class="overview-lead">${industrySection.points.map(point => `<p>${highlightMetrics(point)}</p>`).join('')}</div></div>`
    : '';
  const facts = factSections.map(section => {
    const category = section.category === '산업 총평' ? '주요 사실' : section.category;
    const chip = category
      ? `<p class="summary-cat ${summaryCategoryClass[category] || ''}">${escapeHtml(category)}</p>`
      : '';
    return `<div class="summary-block">${chip}<ul>${section.points.map(point => `<li>${formatSummaryPoint(point)}</li>`).join('')}</ul></div>`;
  }).join('');
  const factPart = facts ? `<div class="report-part part-facts">${dailyPartHead('오늘의 사실', 'fact', '사실 · 본문 대조를 통과한 기사에서')}<div class="fact-grid">${facts}</div></div>` : '';
  target.innerHTML = `${industry}${factPart}`;
  renderDailyInsight();
}
// 세 부분이 같은 머리 모양을 쓴다. 표지(사실/해석)는 부분 이름 옆 작은 글자로만 가른다.
function dailyPartHead(title, kind, label, id = ''){
  return `<div class="part-head"><span class="part-no" aria-hidden="true"></span><h3${id ? ` id="${id}"` : ''}>${escapeHtml(title)}</h3><span class="part-kind ${kind}">${escapeHtml(label)}</span></div>`;
}

// 해석은 사실이 아니다. prd.md의 "사실, 해석, 추정을 구분한다"에 따라 영역을 나누고
// 판단의 근거가 된 사실을 항목마다 함께 보여준다.
function renderDailyInsight(){
  const target = document.querySelector('#daily-insight');
  if (!target) return;
  const sections = parseDailySections(dailyReportInsight || []).filter(section => !['산업 총평', '오늘의 그림'].includes(section.category));
  if (!sections.length) { target.innerHTML = ''; return; }
  // 해석은 사실 목록과 성격이 다르다. 판단과 근거를 각각 불릿으로 끊으면 조각나 보이므로
  // 한 문단으로 잇고, 근거는 문단 끝에 덧붙여 판단과 구분만 되게 한다.
  const body = sections.map(section => {
    const blocks = section.points.map(point => {
      const segment = point.match(/^\[([^\]]+)\]\s*(.+)$/);
      const chip = segment ? `<span class="insight-seg">${escapeHtml(segment[1])}</span>` : '';
      const rest = segment ? segment[2] : point;
      const split = rest.match(/^(.*?)\s*근거[:：]\s*(.+)$/);
      const lead = (split ? split[1] : rest).trim();
      const basis = split ? split[2].trim() : '';
      return `<p class="insight-point">${chip}${highlightMetrics(lead)}${basis ? `<span class="insight-basis">근거 · ${highlightMetrics(basis)}</span>` : ''}</p>`;
    }).join('');
    return `<div class="insight-block">${blocks}</div>`;
  }).join('');
  target.innerHTML = `<div class="report-part part-insight" data-eyebrow="KOREAN MATERIALS INSIGHT">${dailyPartHead('한국 소재사 관점', 'interp', '해석 · 위 사실에서 읽은 한국 소재사 함의', 'insight-title')}${body}</div>`;
}
function feedbackClientKey(){
  const key = 'cbl_feedback_client_key';
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
function attachFeedback(node, article){
  if (!article.id) return;
  const toast = node.querySelector('.feedback-toast');
  node.querySelectorAll('.feedback-button').forEach(button => button.addEventListener('click', async () => {
    const vote = button.dataset.vote;
    const buttons = [...node.querySelectorAll('.feedback-button')];
    buttons.forEach(item => { item.disabled = true; });
    try {
      const result = await fetch('/api/news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articleId: article.id, clientKey: feedbackClientKey(), vote }) });
      if (!result.ok) {
        const payload = await result.json().catch(() => ({}));
        throw new Error(`${result.status}${payload.status ? ` · ${payload.status}` : ''}`);
      }
      buttons.forEach(item => item.classList.toggle('is-selected', item.dataset.vote === vote));
      if (toast) {
        toast.textContent = '반영했습니다. 다음 Daily 선별에 참고합니다.';
        toast.hidden = false;
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 1000);
      }
    } catch (error) { window.alert(`의견을 저장하지 못했습니다. ${error.message || '응답을 확인할 수 없습니다.'}`); }
    finally { buttons.forEach(item => { item.disabled = false; }); }
  }));
}
function renderTopNews(){
  const template = document.querySelector('#news-template');
  const target = document.querySelector('#news-feed'); target.innerHTML = '';
  const more = document.querySelector('#news-more');
  if (!approvedTop10.length) {
    if (more) more.hidden = true;
    return;
  }
  // 처음에는 4건만 보이고, 더보기로 Top 10까지 펼친다.
  const visible = topNewsExpanded ? approvedTop10 : approvedTop10.slice(0, TOP_NEWS_PREVIEW);
  if (more) {
    const hidden = approvedTop10.length - TOP_NEWS_PREVIEW;
    more.hidden = hidden <= 0;
    more.textContent = topNewsExpanded ? '접기' : `더보기 ${hidden}건`;
  }
  visible.forEach((item, index) => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = `TOP ${index + 1}`; sector.classList.toggle('anode', false);
    const confidenceTag = node.querySelector('.confidence-tag'); confidenceTag.textContent = item.confidence; confidenceTag.title = item.confidenceTitle || '';
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.news-fact').innerHTML = renderFactHtml(item.fact);
    node.querySelector('.impact-reason').textContent = item.why;
    node.querySelector('a').href = item.url;
    attachFeedback(node, item);
    target.append(node);
  });
}

function renderHeadlineSankey(){
  const counts = new Map();
  // 검증 기사와 미검증 헤드라인을 따로 센다. 툴팁이 둘을 나눠 보여야 얼마나 믿을지 읽는 사람이 정할 수 있다.
  const grades = new Map();
  // 왜 그 방향인지는 서버가 신호마다 판단해 내려준다. 화면은 그 근거를 모아 툴팁으로 보여준다.
  const reasons = new Map();
  const includeHeadlines = document.querySelector('#sankey-include-headlines')?.checked === true;
  let headlineArticles = 0;
  // 오른쪽 노드 라벨(keyword)은 서버가 테마 10개로 접어 내려준다. 화면에서 다시 다듬지 않는다.
  rangeFlows.forEach(({company_id, keyword, direction, reason, title, grade, matched, top10, merged}) => {
    if (!keyword || !['positive', 'negative'].includes(direction)) return;
    const isHeadline = grade === 'headline';
    if (isHeadline && !includeHeadlines) return;
    if (isHeadline) headlineArticles += 1;
    const key = `${company_id}\u0000${direction}\u0000${keyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const gradeCount = grades.get(key) || { verified: 0, headline: 0, top10: 0, merged: 0 };
    gradeCount[isHeadline ? 'headline' : 'verified'] += 1;
    if (top10) gradeCount.top10 += 1;
    // 같은 소식의 미검증 헤드라인은 서버가 이 흐름에 합쳐 두었다. 헤드라인을 켰을 때만 알린다.
    if (includeHeadlines && merged) gradeCount.merged += Number(merged) || 0;
    grades.set(key, gradeCount);
    if (reason || title) {
      // 제목과 근거 문장을 줄을 나눠 담는다. 도착지 라벨만 되풀이하면 툴팁이 쓸모없다.
      // 헤드라인은 근거가 제목뿐이라 그렇게 표시하고, 어떤 표현이 신호로 잡혔는지만 덧붙인다.
      const bucket = reasons.get(key) || [];
      const line = isHeadline
        ? [`· [헤드라인] ${title}`, matched ? `  잡힌 표현: ${matched}` : ''].filter(Boolean).join('\n')
        : [title ? `· ${top10 ? '[Top 10] ' : ''}${title}` : '', reason ? `  ${reason}` : ''].filter(Boolean).join('\n');
      if (bucket.length < 3 && !bucket.includes(line)) bucket.push(line);
      reasons.set(key, bucket);
    }
  });
  const flows = [...counts.entries()].map(([key, count]) => {
    const [company, direction, keyword] = key.split('\u0000');
    return { company, direction, keyword, count, grades: grades.get(key) || { verified: count, headline: 0, top10: 0, merged: 0 }, reasons: reasons.get(key) || [] };
  });
  const target = document.querySelector('#headline-sankey');
  if (!flows.length) {
    target.innerHTML = includeHeadlines
      ? '<p>선택 기간에 확대·축소 신호로 분류된 기사가 없습니다.</p>'
      : '<p>선택 기간에 본문 검증을 통과한 기사 중 확대·축소 신호가 없습니다. "미검증 헤드라인 포함"을 켜면 표본이 넓어집니다.</p>';
    return;
  }
  const totals = new Map();
  flows.forEach(flow => { const key = `${flow.direction}\u0000${flow.keyword}`; totals.set(key, (totals.get(key) || 0) + flow.count); });
  const selectedNodes = ['positive', 'negative'].flatMap(direction => [...totals.entries()]
    .filter(([key]) => key.startsWith(`${direction}\u0000`))
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([key, count]) => ({ direction, keyword: key.split('\u0000')[1], count })));
  const matchedFlows = flows.filter(flow => selectedNodes.some(node => node.direction === flow.direction && node.keyword === flow.keyword));
  // 기간을 넓히면 신호가 잡힌 회사가 계속 늘어 그래프가 읽기 힘들 만큼 길어진다.
  // 그럴 때는 신호 건수 상위 기업만 남긴다. 표시 순서는 밸류체인별로 묶고, 각 묶음 안에서는 신호가 많은 회사부터 둔다.
  const allCompanies = [...new Set(matchedFlows.map(flow => flow.company))];
  const flowCount = id => matchedFlows.filter(flow => flow.company === id).reduce((sum, flow) => sum + flow.count, 0);
  const compareByFlowCount = (x, y) => flowCount(y) - flowCount(x) || displayName(x).localeCompare(displayName(y), 'ko');
  const chainOrder = { cell: 0, cathode: 1, anode: 2 };
  const sourceNames = (allCompanies.length > SANKEY_COMPANY_LIMIT
    ? [...allCompanies].sort(compareByFlowCount).slice(0, SANKEY_COMPANY_LIMIT)
    : allCompanies)
    .sort((x, y) => (chainOrder[companyById(x)?.value_chain] ?? 99) - (chainOrder[companyById(y)?.value_chain] ?? 99) || compareByFlowCount(x, y));
  const hiddenCount = allCompanies.length - sourceNames.length;
  const visible = matchedFlows.filter(flow => sourceNames.includes(flow.company));
  const positiveNodes = selectedNodes.filter(node => node.direction === 'positive');
  const negativeNodes = selectedNodes.filter(node => node.direction === 'negative');
  const height = Math.max(300, sourceNames.length * 34 + 70, selectedNodes.length * 34 + 112);
  const yFor = (names, name, top, gap) => top + names.indexOf(name) * gap;
  // 회사명 앞에 밸류체인 구분을 붙이되, 색과 굵기를 달리해 구분과 회사명이 섞이지 않게 한다.
  const curve = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 130} ${y1}, ${x2 - 130} ${y2}, ${x2} ${y2}`;
  const nodeY = node => node.direction === 'positive' ? 62 + positiveNodes.indexOf(node) * 34 : 96 + positiveNodes.length * 34 + negativeNodes.indexOf(node) * 34;
  const links = visible.map(flow => {
    const sy = yFor(sourceNames, flow.company, 48, 34) + 12;
    const node = selectedNodes.find(item => item.direction === flow.direction && item.keyword === flow.keyword);
    const ky = nodeY(node) + 12;
    const color = flow.direction === 'positive' ? '#398261' : '#bc5b5b';
    const breakdown = [flow.grades.headline ? `검증 ${flow.grades.verified} · 헤드라인 ${flow.grades.headline}` : '', flow.grades.top10 ? `Top 10 기사 ${flow.grades.top10}건` : '', flow.grades.merged ? `같은 소식 헤드라인 ${flow.grades.merged}건은 합침` : ''].filter(Boolean).join(' · ');
    const tip = `${displayName(flow.company)} → ${flow.keyword} · ${flow.direction === 'positive' ? '확대' : '축소'} ${flow.count}건${breakdown ? ` (${breakdown})` : ''}${flow.reasons.length ? `\n\n${flow.reasons.join('\n\n')}` : ''}`;
    return `<path d="${curve(268, sy, 600, ky)}" fill="none" stroke="${color}" stroke-width="${Math.min(18, 3 + flow.count * 3)}" stroke-opacity="${flow.grades.top10 ? '.82' : '.5'}" data-tip="${escapeHtml(tip)}"/>`;
  }).join('');
  // 밸류체인 구분과 회사명을 아예 다른 상자로 나눈다. 구분은 좁은 색 상자, 회사명은 그 옆 상자다.
  const CHAIN_BOX = 52, GAP = 6, NAME_BOX = 186;
  const companyNodes = sourceNames.map(id => {
    const y = yFor(sourceNames, id, 48, 34);
    const chain = companyById(id)?.value_chain;
    return `<g>`
      + `<rect x="14" y="${y}" width="${CHAIN_BOX}" height="24" rx="4" fill="${CHAIN_BG[chain] || '#eef2f6'}"/>`
      + `<text x="${14 + CHAIN_BOX / 2}" y="${y + 16}" text-anchor="middle" fill="${CHAIN_COLORS[chain] || '#7b8a9c'}" font-size="10.5" font-weight="800">${escapeHtml(valueChainLabels[chain] || '기타')}</text>`
      + `<rect x="${14 + CHAIN_BOX + GAP}" y="${y}" width="${NAME_BOX}" height="24" rx="4" fill="#eaf3fb"/>`
      + `<text x="${14 + CHAIN_BOX + GAP + 8}" y="${y + 16}" fill="#14263d" font-size="11" font-weight="600">${escapeHtml(displayName(id))}</text>`
      + `</g>`;
  }).join('');
  const nodeReasons = node => {
    const nodeFlows = visible.filter(flow => flow.direction === node.direction && flow.keyword === node.keyword);
    const lines = nodeFlows.flatMap(flow => flow.reasons);
    const unique = [...new Set(lines)].slice(0, 4);
    const headlineCount = nodeFlows.reduce((sum, flow) => sum + flow.grades.headline, 0);
    const breakdown = headlineCount ? ` (검증 ${node.count - headlineCount} · 헤드라인 ${headlineCount})` : '';
    const head = `${node.keyword} · ${node.direction === 'positive' ? '확대' : '축소'} 신호 ${node.count}건${breakdown}`;
    return unique.length
      ? `${head}\n\n${unique.join('\n\n')}`
      : `${head}\n\n근거로 쓸 기사 요약이 없습니다. 수집·분석을 다시 실행하면 채워집니다.`;
  };
  const signalNodes = selectedNodes.map(node => `<g data-tip="${escapeHtml(nodeReasons(node))}"><rect x="600" y="${nodeY(node)}" width="190" height="24" rx="4" fill="${node.direction === 'positive' ? '#e3f5ed' : '#fbe9e9'}"/><text x="608" y="${nodeY(node) + 16}" fill="#14263d" font-size="11" font-weight="700">${escapeHtml(node.keyword)} · ${node.count}건</text></g>`).join('');
  const noticeParts = [];
  if (hiddenCount) noticeParts.push(`신호가 잡힌 ${allCompanies.length}개사 중 <strong>신호 건수 상위 ${sourceNames.length}개사</strong>만 표시합니다. 나머지 ${hiddenCount}개사는 기간을 좁히면 보입니다.`);
  if (headlineArticles) noticeParts.push(`미검증 헤드라인 신호 <strong>${headlineArticles}건</strong>이 포함돼 있습니다. 제목만으로 분류한 것이라 툴팁에서 검증 건수와 나눠 표시합니다.`);
  if (includeHeadlines && rangeHeadlineDuplicates) noticeParts.push(`검증 기사나 다른 헤드라인과 같은 소식인 미검증 헤드라인 신호 ${rangeHeadlineDuplicates}건은 한 번만 셌습니다.`);
  const notice = noticeParts.length ? `<p class="sankey-notice">${noticeParts.join('<br>')}</p>` : '';
  target.innerHTML = `${notice}<svg viewBox="0 0 820 ${height}" role="img" aria-label="기업별 확대 및 축소 헤드라인 신호 흐름도" style="display:block;width:100%;height:auto;min-height:300px"><text x="14" y="20" fill="#617187" font-size="11" font-weight="700">기업</text><text x="600" y="20" fill="#398261" font-size="11" font-weight="700">확대 신호 · 상위 4</text><text x="600" y="${80 + positiveNodes.length * 34}" fill="#bc5b5b" font-size="11" font-weight="700">축소 신호 · 상위 4</text>${links}${companyNodes}${signalNodes}</svg>`;
}
function renderCompanyNews(){
  const valueChainTarget = document.querySelector('#company-news-value-chain');
  const companyTarget = document.querySelector('#company-news-company');
  valueChainTarget.innerHTML = Object.entries(valueChainLabels).map(([key, label]) => `<button class="segment ${key === currentNewsValueChain ? 'is-selected' : ''}" data-news-value-chain="${key}">${label}</button>`).join('');
  const companiesInChain = companiesInValueChain(currentNewsValueChain);
  if (!companiesInChain.some(company => company.id === currentNewsCompany)) currentNewsCompany = 'all';
  companyTarget.innerHTML = `<option value="all">${valueChainLabels[currentNewsValueChain]} 전체</option>${companiesInChain.map(company => `<option value="${escapeHtml(company.id)}" ${company.id === currentNewsCompany ? 'selected' : ''}>${escapeHtml(company.name_ko)}</option>`).join('')}`;
  const template = document.querySelector('#news-template');
  const target = document.querySelector('#company-news-feed'); target.innerHTML = '';
  const filtered = approvedCompanyNews.filter(item =>
    (item.valueChains || [item.valueChain]).includes(currentNewsValueChain)
    && (currentNewsCompany === 'all' || (item.companies || [item.company]).includes(currentNewsCompany)));
  if (!filtered.length) {
    const who = currentNewsCompany === 'all' ? valueChainLabels[currentNewsValueChain] : companyTarget.selectedOptions[0]?.textContent;
    const from = document.querySelector('#news-from')?.value, to = document.querySelector('#news-to')?.value;
    const period = from && to ? (from === to ? from : `${from} ~ ${to}`) : '선택 기간';
    target.innerHTML = `<p>${escapeHtml(period)}에 ${escapeHtml(who || '')}의 자동 팩트체크 완료 뉴스가 없습니다. 기간을 넓혀 다시 적용해 보세요.</p>`;
  }
  filtered.forEach(item => {
    const node = template.content.cloneNode(true);
    // 여러 회사에 걸린 기사는 그 회사들을 함께 보여 준다. 지금 고른 회사를 앞에 세운다.
    const linked = item.companies || [item.company];
    const ordered = currentNewsCompany !== 'all' && linked.includes(currentNewsCompany)
      ? [currentNewsCompany, ...linked.filter(id => id !== currentNewsCompany)]
      : linked;
    const sector = node.querySelector('.sector-tag');
    sector.textContent = ordered.slice(0, 3).map(displayName).join(' · ');
    sector.title = ordered.map(displayName).join(', ');
    sector.classList.toggle('anode', false);
    const confidenceTag = node.querySelector('.confidence-tag'); confidenceTag.textContent = item.confidence; confidenceTag.title = item.confidenceTitle || '';
    // Top 10에도 오른 기사는 표식을 달아 첫 화면과 겹쳐 보이는 이유를 알 수 있게 한다.
    if (item.top10Rank) {
      const badge = document.createElement('span');
      badge.className = 'top10-badge';
      badge.textContent = `Top 10 · ${item.top10Rank}위`;
      confidenceTag.after(badge);
    }
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.news-fact').innerHTML = renderFactHtml(item.fact);
    node.querySelector('.impact-reason').textContent = item.why;
    node.querySelector('a').href = item.url;
    attachFeedback(node, item);
    target.append(node);
  });
  document.querySelectorAll('[data-news-value-chain]').forEach(button => button.addEventListener('click', () => { currentNewsValueChain = button.dataset.newsValueChain; currentNewsCompany = 'all'; renderCompanyNews(); }));
  companyTarget.addEventListener('change', () => { currentNewsCompany = companyTarget.value; renderCompanyNews(); });
}
function mapDashboardArticle(article){
  const relation = article.article_company?.[0];
  // 기사 하나가 여러 회사에 걸릴 수 있다. 첫 회사만 보면 "CATL, 후난위넝 지분 감축" 같은
  // 기사가 한쪽에서만 보인다. 연결된 회사와 밸류체인을 모두 들고 다니며 걸러 낸다.
  const links = (article.article_company || []).filter((row) => row?.company_id);
  const companies = [...new Set(links.map((row) => row.company_id))];
  const valueChains = [...new Set(links
    .map((row) => row.company?.type_tags?.[0] || companyById(row.company_id)?.value_chain)
    .filter(Boolean))];
  return {
    companies: companies.length ? companies : ['기타'],
    valueChains: valueChains.length ? valueChains : ['other'],
    id: article.id,
    sector: 'all',
    company: relation?.company_id || '기타',
    valueChain: relation?.company?.type_tags?.[0] || companyById(relation?.company_id)?.value_chain || 'other',
    date: article.published_at ? article.published_at.slice(0, 10).replaceAll('-', '.') : '날짜 미상',
    title: article.title_ko || article.title_original,
    fact: article.summary_ko || '한국어 팩트 요약 검수 대기',
    why: `출처: ${article.source_name || '출처 미상'}`,
    confidence: article.verification_status === 'verified' ? '본문대조 완료' : article.verification_status === 'pending' ? '미분석' : article.source_tier || '검수 완료',
    confidenceTitle: article.verification_status === 'verified' ? '원문 본문 대조 팩트체크 완료' : article.verification_status === 'pending' ? '미분석 수집 원문' : article.source_tier || '검수 완료',
    top10Rank: article.is_top10 ? article.top10_rank : null,
    url: article.canonical_url,
    sourceName: article.source_name
  };
}
// 접근 세션이 끝나면 API가 401을 준다. 조용히 넘기면 화면이 예전 상태로 멈춰 "안 된다"로만 보인다.
// 입장 화면을 다시 띄워 무슨 일인지 알리고 키를 다시 받는다.
function requireReentry(){
  const gate = document.querySelector('#access-gate');
  const shell = document.querySelector('#app-shell');
  const message = document.querySelector('#access-message');
  if (gate) gate.hidden = false;
  if (shell) shell.hidden = true;
  if (message) message.textContent = '접근 세션이 만료됐습니다. 접근 키를 다시 입력해 주세요.';
}
function showLoadFailure(text){
  const sankey = document.querySelector('#headline-sankey');
  if (sankey) sankey.innerHTML = `<p class="load-failure">${escapeHtml(text)}</p>`;
}
// 지난 Daily 리포트는 날짜별로 DB에 쌓인다. 목록을 채워 두고, 고른 날짜는 새 탭으로 연다.
function renderReportArchive(dates, current){
  const picker = document.querySelector('#report-date-picker');
  if (!picker) return;
  const list = Array.isArray(dates) ? dates : [];
  if (!list.length) { picker.innerHTML = '<option value="">저장된 리포트 없음</option>'; picker.disabled = true; return; }
  picker.disabled = false;
  picker.innerHTML = list.map(date =>
    `<option value="${escapeHtml(date)}"${date === current ? ' selected' : ''}>${escapeHtml(date)}${date === list[0] ? ' (최신)' : ''}</option>`
  ).join('');
}
// ?report=YYYY-MM-DD로 열면 그날 리포트만 보여준다. 새 탭으로 띄워 여러 날짜를 나란히 볼 수 있다.
function reportDateFromUrl(){
  const value = new URLSearchParams(window.location.search).get('report') || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function enterSingleReportView(date){
  document.body.classList.add('single-report');
  const heading = document.querySelector('#daily-title');
  if (heading) heading.textContent = `${date} 리포트`;
  const sub = heading?.nextElementSibling;
  if (sub) sub.textContent = '저장된 날짜별 Daily 리포트입니다. 이 화면은 해당 날짜의 사실과 해석만 보여줍니다.';
}
// 상단바 "데이터 기준" 라벨을 실제 수집된 최신 데이터 날짜로 갱신한다.
// 최신 뉴스(기사 발행일)와 Daily 리포트 날짜 중 더 최근을 쓴다. 데이터가 하나도
// 없으면(아직 크롤링 전) 기존 표시를 건드리지 않는다.
function updateAsOf(payload){
  const el = document.querySelector('#as-of-text');
  if (!el) return;
  const dates = [];
  for (const list of [payload?.top10, payload?.companyNews, payload?.pendingNews]) {
    for (const item of (list || [])) {
      const day = String(item?.published_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.push(day);
    }
  }
  const reportDay = payload?.report?.report_date || String(payload?.report?.generated_at || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(reportDay)) dates.push(reportDay);
  if (!dates.length) return;
  const latest = dates.sort().at(-1);
  el.textContent = `데이터 기준 ${latest.replace(/-/g, '.')} · 내부 검토용`;
}
async function loadDashboardFromApi(){
  try {
    const from = document.querySelector('#sankey-from')?.value;
    const to = document.querySelector('#sankey-to')?.value;
    const params = new URLSearchParams(); if (from) params.set('from', from); if (to) params.set('to', to);
    // 회사별 뉴스 기간. 비워 두면 서버가 오늘 하루로 잡는다.
    const newsFrom = document.querySelector('#news-from')?.value;
    const newsTo = document.querySelector('#news-to')?.value;
    if (newsFrom) params.set('newsFrom', newsFrom);
    if (newsTo) params.set('newsTo', newsTo);
    // 특정 날짜 리포트를 요청받았으면 그 날짜를 서버에 넘긴다.
    const wantedReport = reportDateFromUrl();
    if (wantedReport) params.set('report', wantedReport);
    params.set('_', Date.now().toString());
    const sankeyBox = document.querySelector('#headline-sankey');
    if (sankeyBox) sankeyBox.innerHTML = `<p class="load-note">${escapeHtml(from && to ? `${from} ~ ${to} 기간을 불러오는 중…` : '불러오는 중…')}</p>`;
    const result = await fetch(`/api/dashboard?${params}`, { cache: 'no-store' });
    if (result.status === 401) { requireReentry(); return; }
    if (!result.ok) { showLoadFailure(`첫 화면 데이터를 불러오지 못했습니다 (HTTP ${result.status}).`); return; }
    const payload = await result.json();
    if (payload.status !== 'ok') { showLoadFailure(`첫 화면 데이터를 불러오지 못했습니다 (${payload.status}).`); return; }
    if (Array.isArray(payload.errors) && payload.errors.length) {
      console.error('dashboard query errors', payload.errors);
      window.alert(`서버 조회 일부 실패:\n${payload.errors.map(item => `· ${item.name}: ${item.message}`).join('\n')}`);
    }
    approvedTop10 = (payload.top10 || []).map(mapDashboardArticle);
    // Top 10에 뽑힌 기사도 회사별 뉴스에 그대로 싣는다. 예전에는 중복을 피한다고 걸러냈는데,
    // 하루 분석량이 적을 때 대부분이 Top 10으로 빠져 회사별 뉴스가 한두 건만 남았다.
    approvedCompanyNews = (payload.companyNews || []).map(mapDashboardArticle);
    rangeFlows = payload.flows || [];
    rangeHeadlineDuplicates = Number(payload.counts?.sankey_headline_duplicates) || 0;
    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\n+/).filter(Boolean);
    }
    dailyReportInsight = payload.report?.insight_ko ? payload.report.insight_ko.split(/\n+/).filter(Boolean) : null;
    renderReportArchive(payload.report_dates, payload.report?.report_date);
    // 특정 날짜를 요청했는데 그날 리포트가 없으면 이전 화면 내용이 남지 않게 비운다.
    if (payload.requested_report && !payload.report) { dailyReportFacts = []; dailyReportInsight = null; }
    // 수집된 최신 데이터 날짜로 "데이터 기준"을 갱신한다.
    updateAsOf(payload);
    renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  } catch {
    // 환경변수 미설정·DB 초기화 전에는 시드 화면을 유지한다.
  }
}
let currentChain = 'cathode';
let includeSupporting = false;
// 정책은 필요할 때만 열어 본다. 기업 사실·시장·기술 축이 기본 화면의 주인공이다.
let includePolicy = false;

// 기업 시계열 표는 공시 원문에서 나온 사실과 핵심 등급 기사만 기본으로 보여준다.
// 참고 등급 기사와 웹 검색 백필은 시장·기술 구분과 무관하게 '보조 데이터 포함'을
// 켰을 때만 나온다. 연차보고서 그래프 아래의 시장·기술 레인은 이 필터와 별개다.
const evidenceLabels = { annual_report: '연차보고서', periodic_report: '반기·분기보고서', disclosure: '거래소 공시', article: '언론', web_backfill: '웹 검색' };
function isPrimaryEvidence(event){
  // 거래소 공시는 회사가 직접 낸 1차 출처라 정기보고서와 같은 핵심 등급으로 본다.
  if (event.kind === 'annual_report' || event.kind === 'periodic_report' || event.kind === 'disclosure') return true;
  return event.kind === 'article' && event.eligibility === '핵심';
}
function visibleEvents(timeline){
  return includeSupporting ? timeline.events : timeline.events.filter(isPrimaryEvidence);
}
// 보조 데이터는 같은 시계열을 넓혀 보는 옵션일 뿐, 사용자를 페이지 맨 위로 보내면 안 된다.
// 기업 프로필·차트가 다시 그려져도 토글의 화면상 위치를 기준으로 스크롤을 되돌린다.
async function refreshSupportingViews(anchor){
  const topBefore = anchor?.getBoundingClientRect().top;
  await Promise.all([renderCompany(), renderComparison()]);
  if (!Number.isFinite(topBefore) || !anchor?.isConnected) return;
  await new Promise(resolve => requestAnimationFrame(resolve));
  window.scrollBy(0, anchor.getBoundingClientRect().top - topBefore);
}
// 드롭다운 대신 밸류체인 탭 → 회사 칩으로 고른다. 칩의 아이콘은 중문 법인명 첫 글자다.
function renderCompanyPicker(){
  const tabs = document.querySelector('#company-chain-tabs');
  const chips = document.querySelector('#company-chips');
  if (!tabs || !chips) return;
  if (!companyCatalog.length) {
    tabs.innerHTML = '';
    chips.innerHTML = '<p class="picker-empty">기업 목록을 불러오지 못했습니다. 접근 세션을 확인한 뒤 새로고침해 주세요.</p>';
    return;
  }
  tabs.innerHTML = Object.entries(valueChainLabels).map(([key, label]) =>
    `<button class="segment ${key === currentChain ? 'is-selected' : ''}" type="button" data-chain="${key}">${label}<span class="segment-count">${companiesInValueChain(key).length}</span></button>`).join('');
  chips.innerHTML = companiesInValueChain(currentChain).map(company => {
    const mark = (company.name_zh || company.name_en || '?').slice(0, 1);
    // 칸이 좁으므로 종목코드와 순위만 한 줄로 담고, 중국어·영어 법인명은 툴팁으로 넘긴다.
    const meta = [company.ticker || '비상장', company.priority ? `SNE ${company.priority}위` : '순위 미확인'].join(' · ');
    const full = [company.name_zh, company.name_en].filter(Boolean).join(' · ');
    // 공식 홈페이지가 확인된 회사는 그 사이트의 아이콘을 마크로 쓴다. 못 불러오면 한자 첫 글자로 되돌린다.
    // 구글 파비콘은 아이콘이 없어도 지구본을 200으로 돌려줘 폴백이 걸리지 않는다. 없으면 404를 주는 쪽을 쓴다.
    const markInner = company.homepage
      ? `<img class="chip-logo" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(company.homepage)}.ico" alt="" loading="lazy" data-fallback="${escapeHtml(mark)}">`
      : escapeHtml(mark);
    return `<button class="company-chip ${company.value_chain} ${company.id === currentCompany ? 'is-selected' : ''}" type="button" data-company="${escapeHtml(company.id)}" title="${escapeHtml(full)}"><span class="chip-mark">${markInner}</span><span class="chip-body"><span class="chip-name">${escapeHtml(company.name_ko)}</span><span class="chip-meta">${escapeHtml(meta)}</span></span></button>`;
  }).join('');
  tabs.querySelectorAll('[data-chain]').forEach(button => button.addEventListener('click', () => {
    currentChain = button.dataset.chain;
    renderCompanyPicker();
  }));
  // 아이콘을 못 가져오면 한자 첫 글자로 되돌린다. 인라인 핸들러를 쓰지 않으려고 여기서 건다.
  chips.querySelectorAll('.chip-logo').forEach(img => img.addEventListener('error', () => {
    const holder = img.parentElement;
    if (holder) holder.textContent = img.dataset.fallback || '';
  }));
  chips.querySelectorAll('[data-company]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.company === currentCompany) return;
    currentCompany = button.dataset.company;
    renderCompanyPicker();
    renderCompany();
  }));
}
// 비교 화면의 회사 선택은 밸류체인(셀사/양극재/음극재)을 먼저 고르고 그 안에서 회사를 고른다.
function makeSelect(select, selected, chain){
  const list = chain ? companiesInValueChain(chain) : companyCatalog;
  if (!list.length) { select.innerHTML = '<option value="">기업 목록 없음</option>'; return; }
  const chosen = list.some(company => company.id === selected) ? selected : list[0].id;
  select.innerHTML = list.map(company => `<option value="${escapeHtml(company.id)}" ${company.id === chosen ? 'selected' : ''}>${escapeHtml(company.name_ko)}</option>`).join('');
}
function makeChainTabs(container, chain, onChange){
  container.innerHTML = Object.entries(valueChainLabels).map(([key, label]) => `<button type="button" class="segment${key === chain ? ' is-selected' : ''}" data-chain="${key}">${label}</button>`).join('');
  container.querySelectorAll('.segment').forEach(button => button.addEventListener('click', () => {
    container.querySelectorAll('.segment').forEach(b => b.classList.toggle('is-selected', b === button));
    onChange(button.dataset.chain);
  }));
}
async function loadCompanyCatalog(){
  try {
    const result = await fetch('/api/company', { cache: 'no-store' });
    const payload = await result.json();
    if (payload.status === 'ok' && Array.isArray(payload.companies)) companyCatalog = payload.companies;
  } catch {
    // 회사 마스터를 못 불러와도 Daily 화면은 그대로 동작한다.
  }
}
function normalizeEvent(event){
  const layer = layerLabels[event.layer_key] ? event.layer_key : UNCLASSIFIED_LAYER;
  const group = layer === UNCLASSIFIED_LAYER
    ? (event.trajectory_track === 'technology' ? '기술' : '시장')
    : (marketLayerLabels[layer] ? '시장' : '기술');
  return {
    id: event.id,
    date: String(event.occurred_at || '').slice(0, 10),
    precision: event.occurred_precision || 'day',
    dateBasis: event.occurred_basis || '',
    group, layer, track: group === '기술' ? 'tech' : 'market',
    label: layerLabels[layer] || '미분류',
    both: event.trajectory_track === 'both',
    title: event.title_ko || '제목 미상',
    fact: event.fact_ko || '',
    displaySummary: event.display_summary_ko || '',
    region: event.region_scope || '',
    eligibility: event.timeline_eligibility === 'core' ? '핵심' : event.timeline_eligibility === 'reference' ? '참고' : '',
    sourceName: event.source_name || event.article?.source_name || '출처 미상',
    sourceUrl: event.source_url || event.article?.canonical_url || '',
    // 기사 발행일. 사건 시점(date)과 다를 수 있다(회고 기사). 기사 없이 들어온 사실은 비워 둔다.
    sourceDate: /^\d{4}-\d{2}-\d{2}/.test(String(event.article?.published_at || '')) ? String(event.article.published_at).slice(0, 10) : '',
    excerpt: event.original_excerpt || '',
    excerptKo: event.original_excerpt_ko || '',
    kind: event.evidence_kind || 'article',
    entities: Array.isArray(event.entity_names) ? event.entity_names.filter(Boolean) : []
  };
}
function timelineNotice(status){
  if (status === 'ok') return '';
  if (status === 'not_configured') return 'Supabase 환경변수가 설정되지 않아 이벤트를 불러오지 못했습니다.';
  if (status === 'access_required') return '접근 세션이 만료됐습니다. 다시 입장한 뒤 새로고침해 주세요.';
  if (status === 'unknown_company') return '회사 마스터에 없는 기업입니다.';
  return '이벤트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
async function loadCompanyTimeline(companyId){
  if (companyTimelineCache.has(companyId)) return companyTimelineCache.get(companyId);
  let payload = null;
  try {
    const result = await fetch(`/api/company?companyId=${encodeURIComponent(companyId)}&_=${Date.now()}`, { cache: 'no-store' });
    payload = await result.json();
  } catch {
    payload = null;
  }
  const timeline = {
    status: payload?.status || 'load_failed',
    // 어느 회사의 시계열인지 함께 들고 다닌다. 비교 화면은 두 회사를 동시에 그리므로
    // 화면 전역의 '현재 회사'로는 제목에서 걷어낼 주어를 정할 수 없다.
    companyId,
    events: (payload?.events || []).map(normalizeEvent).filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date)),
    // 정량 궤적의 재료. 비상장사는 셋 다 비어 궤적 영역이 통째로 숨는다.
    metrics: payload?.metrics || [],
    financials: payload?.financials || [],
    policies: (payload?.policies || []).map(normalizeEvent).filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date)),
    // 저장된 정책–회사 연결(보고서 생성 때 판정). 정책 줄에 '직접/간접 연결' 표시와 경로 툴팁을 단다.
    policyLinks: new Map((Array.isArray(payload?.policy_links) ? payload.policy_links : []).map(link => [link.policy_id, link])),
    fx: payload?.fx || [],
    financialsStatus: payload?.financials_status || null,
    // 웹 검증이 찾은 다른 출처. 원래 값은 그대로 두고 그 아래에 함께 보인다.
    alternatives: Array.isArray(payload?.alternatives) ? payload.alternatives : []
  };
  const altByEvent = new Map();
  for (const alt of timeline.alternatives) if (alt.target_kind === 'event' && alt.event_id) altByEvent.set(alt.event_id, [...(altByEvent.get(alt.event_id) || []), alt]);
  for (const event of timeline.events) event.alternatives = altByEvent.get(event.id) || [];
  if (timeline.status === 'ok') companyTimelineCache.set(companyId, timeline);
  return timeline;
}
// 과거 연도는 반기로 묶고, 사용자가 보고 있는 당해 연도만 분기로 나눈다.
// 3년치를 분기로 늘어놓으면 열이 16개가 되어 읽기 어렵다.
// 연간 집계를 특정 하루의 일처럼 보여주면 안 된다. 날짜를 믿을 수 있는 데까지만 적는다.
function displayDate(event){
  const date = String(event.date || '');
  if (!date) return '시점미상';
  if (event.precision === 'year') return `${date.slice(0, 4)}년`;
  if (event.precision === 'half') return `${date.slice(0, 4)}년 ${Number(date.slice(5, 7)) <= 6 ? '상' : '하'}반기`;
  if (event.precision === 'month') return `${date.slice(0, 4)}-${date.slice(5, 7)}`;
  return date;
}
function dateTip(event){
  const label = { year: '연 단위', half: '반기 단위', month: '월 단위', day: '일 단위' }[event.precision] || '일 단위';
  return event.dateBasis ? `시점 정밀도: ${label}\n근거: ${event.dateBasis}` : `시점 정밀도: ${label}`;
}

function periodOf(date){
  const match = String(date).match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year >= new Date().getFullYear()) return `${year} Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year} ${month <= 6 ? '상반기' : '하반기'}`;
}
function periodOrder(period){
  const match = String(period).match(/^(\d{4}) (?:Q(\d)|(상반기|하반기))$/);
  if (!match) return 0;
  const slot = match[2] ? Number(match[2]) : (match[3] === '상반기' ? 1 : 3);
  return Number(match[1]) * 4 + slot;
}
// 기본 축은 최근 3년 + 당해 분기이고, 그 밖의 확인된 이벤트가 있으면 해당 분기도 함께 연다.
function timelinePeriods(events){
  const now = new Date();
  const endYear = now.getFullYear();
  const endQuarter = Math.floor(now.getMonth() / 3) + 1;
  const periods = new Set();
  for (let year = endYear - 3; year < endYear; year += 1) {
    periods.add(`${year} 상반기`);
    periods.add(`${year} 하반기`);
  }
  for (let quarter = 1; quarter <= endQuarter; quarter += 1) periods.add(`${endYear} Q${quarter}`);
  events.forEach(event => { const period = periodOf(event.date); if (period) periods.add(period); });
  return [...periods].sort((a, b) => periodOrder(a) - periodOrder(b));
}
// 그룹 계열사는 모회사 공시로 확인된 것만 등록돼 있으므로 근거 문서를 함께 보여준다.
function groupLine(group){
  if (!group) return '';
  const members = (group.members_ko || []).join(', ');
  const source = group.source?.url
    ? `<a href="${escapeHtml(group.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(group.source.doc_ko || '공식 공시')}</a>`
    : escapeHtml(group.source?.doc_ko || '근거 문서 미등록');
  return `<p style="font-size:12px">그룹 계열사 ${(group.members_ko || []).length}곳: ${escapeHtml(members)}<br>근거: ${source}</p>`;
}
// 계열사에서 일어난 사실은 모회사 사실과 섞이지 않게 발생 법인을 병기한다.
function entityLabel(event){
  return event.entities.length ? event.entities.join(' · ') : '';
}
function sourceLink(event, fontSize){
  if (!event.sourceUrl) return escapeHtml(event.sourceName);
  return `<a href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer"${fontSize ? ` style="font-size:${fontSize}"` : ''}>${escapeHtml(event.sourceName)}</a>`;
}
async function renderCompany(){
  const profile = document.querySelector('#company-profile');
  const grid = document.querySelector('#snapshot-grid');
  const matrix = document.querySelector('#dual-track');
  if (!currentCompany) {
    profile.innerHTML = '<div><h2>추적 기업 목록을 불러오지 못했습니다</h2><p>접근 세션과 네트워크 상태를 확인한 뒤 새로고침해 주세요.</p></div>';
    grid.innerHTML = ''; matrix.innerHTML = '';
    const trajectory = document.querySelector('#trajectory-section');
    if (trajectory) trajectory.hidden = true;
    return;
  }
  const requestedId = currentCompany;
  const company = companyById(requestedId);
  const names = [company.name_zh, company.name_en].filter(Boolean).join(' · ');
  profile.innerHTML = `<div><p class="eyebrow" style="color:#b6dcff">${escapeHtml(valueChainLabels[company.value_chain] || '추적 기업')}</p><h2>${escapeHtml(company.name_ko)}</h2><p>${escapeHtml(names)}</p>${groupLine(company.group)}<p id="company-timeline-state">이벤트를 불러오는 중…</p></div><div class="company-badges">${company.group ? `<span class="company-badge">${escapeHtml(company.group.name_ko)}</span>` : ''}<span class="company-badge">출처 확인 이벤트만 표시</span></div>`;
  grid.innerHTML = ''; matrix.innerHTML = '';
  const timeline = await loadCompanyTimeline(requestedId);
  if (requestedId !== currentCompany) return;
  const state = document.querySelector('#company-timeline-state');
  const notice = timelineNotice(timeline.status);
  const shown = visibleEvents(timeline);
  const hidden = timeline.events.length - shown.length;
  const evidenceKey = shown.map(event => event.id).join(',');
  lastCompanyTimeline = { companyId: requestedId, companyName: company.name_ko, events: shown };
  const reportButtons = document.querySelectorAll('[data-timeline-report-mode]');
  reportButtons.forEach(button => { button.disabled = !shown.length; });
  const reportPanel = document.querySelector('#company-timeline-report-panel');
  // 다른 기업으로 바꾸면 앞 기업의 일회성 리포트를 계속 보여 주지 않는다.
  if (reportPanel && (reportPanel.dataset.companyId !== requestedId || reportPanel.dataset.evidenceKey !== evidenceKey)) {
    reportPanel.hidden = true;
    reportPanel.innerHTML = '';
    reportPanel.dataset.companyId = requestedId;
    reportPanel.dataset.evidenceKey = evidenceKey;
  }
  if (state) {
    state.textContent = notice || (shown.length
      ? `공시·핵심 근거 이벤트 ${shown.length}건을 표시합니다.${hidden ? ` 보조 데이터 ${hidden}건은 숨겨져 있습니다.` : ''}`
      : '표시할 공시 기반 이벤트가 없습니다. 연차보고서 요약을 실행하면 이 화면에 채워집니다.');
  }
  renderTrajectory(timeline);
  renderCompanyEvents(timeline);
  renderLayerMatrix(timeline);
}

function policyInlineItems(policies, links){
  // 발표일과 시행일이 같은 분기에 들어오면 한 정책이 두 번 보인다. 화면에서는 원정책 ID
  // 하나당 한 줄만 남기고, 시행일 일정 항목을 우선해 해당 분기의 변화 시점을 보존한다.
  const unique = new Map();
  for (const policy of policies || []) {
    const baseId = policyBaseId(policy.id);
    const previous = unique.get(baseId);
    if (!previous || String(policy.id || '').includes('-schedule-')) unique.set(baseId, policy);
  }
  return [...unique.values()].map(policy => {
    // 정책 행은 한국어 요약만 쓴다. 시행일·문건 번호는 전체 근거용 메타데이터이므로,
    // 여기서 붙인 괄호를 다시 노출하면 중국어 문건 표기가 화면으로 새어 나온다.
    const fact = String(policy.fact || '').replace(/\s*\(시행:[^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    const summary = fact.length > 150 ? `${fact.slice(0, 147)}…` : fact;
    const title = String(policy.title || '').replace(/ · 시행·유예 일정\(첨부\)$/, '');
    // 보고서 생성 때 판정해 둔 이 회사와의 연결. 경로는 추론이라 툴팁에서 '추론'으로 밝힌다.
    const link = links?.get(policyBaseId(policy.id));
    const linkTip = link ? `이 회사와의 연결(추론·${link.relation === 'direct' ? '직접' : '간접'}): ${link.path_ko}${(link.basis || []).length ? `\n출발점 사건: ${link.basis.map(item => `${item.date} ${item.title}`).join(' / ')}` : ''}` : '';
    const tip = [linkTip, fact, `정책 시점: ${displayDate(policy)}`, `출처: ${policy.sourceName || ''}`].filter(Boolean).join('\n\n');
    const tag = link ? `<span class="policy-inline-tag is-linked">정책 · ${link.relation === 'direct' ? '직접 연결' : '간접 연결'}</span>` : '<span class="policy-inline-tag">정책</span>';
    return `<div class="policy-inline-item${link ? ' is-linked' : ''}" data-tip="${escapeHtml(tip)}">${tag}<span class="policy-inline-title">${escapeHtml(title)}</span>${summary ? `<span class="policy-inline-summary">${escapeHtml(summary)}</span>` : ''}</div>`;
  }).join('');
}
function policyCell(policies, period, links){
  return policyInlineItems((policies || []).filter(policy => periodOf(policy.date) === period), links);
}
function policyBaseId(id){ return String(id || '').replace(/-schedule-\d{4}-\d{2}-\d{2}$/, ''); }

// 리포트 출력은 제한된 Markdown(제목·불릿·표·문단)만 HTML로 바꾼다. 모델 문자열은 항상
// escapeHtml을 거치므로 링크나 태그를 포함해도 실행 가능한 HTML이 되지 않는다.
// 리포트 출력은 제한된 Markdown만 HTML로 바꾼다. 모델 문자열은 먼저 전부 escapeHtml을 거치므로
// 태그가 실행되지 않는다. 그 다음 우리가 아는 표기만 되살린다 — 굵게·기울임·코드·링크·줄바꿈.
// 링크는 http(s)만 통과시킨다.
// 긴 주소는 본문을 덮는다. 맨 주소와 주소가 라벨인 링크는 'link'로 줄이고 새 창에서 연다.
function inlineMarkdown(text){
  const links = [];
  const anchor = (href, label) => {
    links.push(`<a class="report-link" href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noreferrer">${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  };
  return escapeHtml(String(text || ''))
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (whole, label, href) => anchor(href, /^https?:\/\//i.test(label) ? 'link' : label))
    .replace(/https?:\/\/[^\s<>"'()\u0000]+[^\s<>"'().,;:!?\u0000]/g, href => anchor(href, 'link'))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (whole, index) => links[Number(index)]);
}
function renderTimelineMarkdown(markdown){
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out = [];
  const isTable = line => /^\s*\|.+\|\s*$/.test(line);
  const cells = line => line.trim().split('|').slice(1, -1).map(cell => cell.trim());
  const isBullet = line => /^[-*+]\s+/.test(line);
  const isNumbered = line => /^\d+[.)]\s+/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    // 가로줄은 표 구분선과 헷갈리지 않게 먼저 걸러낸다.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { out.push('<hr>'); index += 1; continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length + 1));
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1; continue;
    }
    if (/^&gt;\s?/.test(line) || /^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, '')); index += 1;
      }
      out.push(`<blockquote>${inlineMarkdown(quote.join(' '))}</blockquote>`);
      continue;
    }
    if (isNumbered(line)) {
      const items = [];
      while (index < lines.length && isNumbered(lines[index].trim())) {
        items.push(`<li>${inlineMarkdown(lines[index].trim().replace(/^\d+[.)]\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ol class="timeline-report-list">${items.join('')}</ol>`);
      continue;
    }
    if (isBullet(line)) {
      const items = [];
      while (index < lines.length && isBullet(lines[index].trim())) {
        items.push(`<li>${inlineMarkdown(lines[index].trim().replace(/^[-*+]\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ul class="timeline-report-list">${items.join('')}</ul>`);
      continue;
    }
    if (isTable(line)) {
      const tableLines = [];
      while (index < lines.length && isTable(lines[index])) { tableLines.push(cells(lines[index])); index += 1; }
      const rows = tableLines.filter((row, rowIndex) => rowIndex !== 1 || !row.every(cell => /^[\s:-]+$/.test(cell)));
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(`<div class="timeline-report-table-scroll"><table class="timeline-report-table"><thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      }
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim()
      && !/^#{1,4}\s+/.test(lines[index].trim()) && !isBullet(lines[index].trim())
      && !isNumbered(lines[index].trim()) && !isTable(lines[index])) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return out.join('');
}

const timelineReportModeLabel = { direction: '전략 방향', pattern: '패턴 인사이트', inflection_point: '전략 분기점' };
// 세 용도가 같은 모양으로 보이지 않게, 제목 아래에 그 보고서가 답하는 질문을 둔다.
const timelineReportModeQuestion = {
  direction: '두 시점을 대비해 — 이 기업의 무게중심은 어디서 어디로 옮겨 갔는가?',
  pattern: '사건을 이어 — 하나씩 볼 때는 보이지 않던 연결은 무엇인가?',
  inflection_point: '진행 중인 사건에서 — 앞으로 어느 두 갈래로 갈릴 수 있는가?',
};
function timelineReportParts(payload){
  const report = payload.report || {};
  const modeKey = timelineReportModeLabel[payload.report_mode] ? payload.report_mode : 'direction';
  const modeLabel = timelineReportModeLabel[payload.report_mode] || '전략 방향';
  // 정책은 이 회사와 연결 경로가 판정된 것만 보고서에 들어간다. 전체 정책 수가 아니라 그 수를 적는다.
  const linkedPolicies = Array.isArray(payload.policy_links) ? payload.policy_links.length : 0;
  const policyLine = payload.policy_link_status && payload.policy_link_status !== 'none' ? `과 이 회사에 연결된 중국 정책 ${linkedPolicies}건을` : '을';
  const title = `${payload.company_name_ko || '기업'} ${modeLabel} 리포트`;
  const generated = payload.generated_at ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(payload.generated_at)) : '';
  const markdown = renderTimelineMarkdown(report.markdown_ko || '생성된 리포트가 비어 있습니다.');
  const supportingLabel = payload.include_supporting === true ? '보조 데이터 포함' : '핵심 근거만';
  const body = `<div class="timeline-report-document report-doc mode-${escapeHtml(modeKey)}"><header><p class="eyebrow">COMPANY TIMELINE REPORT · 해석</p><p class="report-mode-badge">${escapeHtml(modeLabel)}</p><h1>${escapeHtml(title)}</h1><p class="report-mode-question">${escapeHtml(timelineReportModeQuestion[modeKey])}</p><p class="meta">시장·기술 이벤트 ${payload.events?.length || 0}건 (${supportingLabel})${policyLine} 근거로 생성 · ${escapeHtml(generated)}${payload.model ? ` · ${escapeHtml(payload.model)}` : ''}</p></header><div class="timeline-report-markdown">${markdown}</div><footer>이 문서는 선택 당시 화면에 표시된 시계열 사실을 바탕으로 한 해석이며, 서버 히스토리나 DB에는 저장되지 않습니다.</footer></div>`;
  return { title, body };
}

// 용도별 강조색. 화면 패널과 HTML 저장본이 같은 규칙 한 벌을 쓴다(패널은 <style>로 함께 넣는다).
// 전략 방향=남색(대비), 패턴=보라(연결), 분기점=주황(갈림).
const TIMELINE_MODE_CSS = '.report-mode-badge{display:inline-block;margin:4px 0 2px;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:800;color:#fff;background:#10365f}.report-mode-question{margin:2px 0 8px;font-size:17px;font-weight:700;color:#10365f}.mode-pattern .report-mode-badge{background:#6b3fa0}.mode-pattern .report-mode-question,.mode-pattern .timeline-report-markdown h2{color:#5a2f8c}.mode-inflection_point .report-mode-badge{background:#b8560f}.mode-inflection_point .report-mode-question,.mode-inflection_point .timeline-report-markdown h2{color:#9a4a0e}.timeline-report-markdown blockquote{margin:14px 0 22px;padding:14px 18px;border-left:5px solid #10365f;background:#f1f5fa;color:#10365f;font-size:1.12em;font-weight:700;line-height:1.6}.mode-pattern .timeline-report-markdown blockquote{border-left-color:#6b3fa0;background:#f5f0fb;color:#4a2775}.mode-inflection_point .timeline-report-markdown blockquote{border-left-color:#b8560f;background:#fdf4ec;color:#7a3a0b}.mode-pattern .timeline-report-markdown code{display:inline-block;margin:1px 0;padding:1px 6px;border-radius:4px;background:#efe7f8;color:#4a2775;font-family:inherit;font-weight:700}';

function downloadTimelineReportHtml(payload){
  const { title, body } = timelineReportParts(payload);
  const styles = `body{margin:0;background:#fff;color:#172235;font-family:Arial,'Noto Sans KR',sans-serif}.report-doc{max-width:1100px;margin:0 auto;padding:32px;font-size:15px;line-height:1.75}.eyebrow,.meta,footer{color:#617187;font-size:13px}.timeline-report-markdown h2{font-size:21px;margin:32px 0 12px;color:#10365f}.timeline-report-markdown h3{font-size:18px;margin:24px 0 8px;color:#236aa6}.timeline-report-markdown strong{color:#1674c5;font-weight:800;background:#edf5ff;padding:0 2px;border-radius:2px}.timeline-report-list{margin:0 0 18px;padding-left:22px}.timeline-report-list li{margin:7px 0}.timeline-report-table-scroll{overflow-x:auto;margin:10px 0 22px;border:1px solid #d7e0ea;border-radius:8px}.timeline-report-table{width:100%;border-collapse:collapse;min-width:780px;font-size:13px;line-height:1.55}.timeline-report-table th,.timeline-report-table td{padding:9px 11px;border-bottom:1px solid #e4eaf0;border-right:1px solid #e4eaf0;text-align:left;vertical-align:top}.timeline-report-table th{background:#edf4fa;color:#10365f;white-space:nowrap}.timeline-report-table td:last-child,.timeline-report-table th:last-child{border-right:0}h1{font-size:30px;margin:4px 0;color:#10365f}@media(max-width:700px){.report-doc{padding:20px}.timeline-report-table{font-size:12px}h1{font-size:25px}}${TIMELINE_MODE_CSS}`;
  const blob = new Blob([`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${body}</body></html>`], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${String(payload.company_id || 'company').replace(/[^a-z0-9_-]/gi, '_')}_timeline_report.html`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function renderTimelineReportPanel(payload){
  const panel = document.querySelector('#company-timeline-report-panel');
  if (!panel) return;
  const { title, body } = timelineReportParts(payload);
  panel.dataset.companyId = payload.company_id || '';
  panel.dataset.evidenceKey = (payload.events || []).map(event => event.id).join(',');
  panel.hidden = false;
  panel.innerHTML = `<details class="report-panel" open><summary><span class="report-title">${escapeHtml(title)}</span><span class="report-actions"><button type="button" class="secondary-button" data-timeline-report-download>HTML로 저장</button><button type="button" class="secondary-button" data-timeline-report-close>닫기</button></span></summary><style>${TIMELINE_MODE_CSS}</style>${body}</details>`;
  panel.querySelector('[data-timeline-report-close]').addEventListener('click', event => { event.preventDefault(); panel.hidden = true; });
  panel.querySelector('[data-timeline-report-download]').addEventListener('click', event => { event.preventDefault(); downloadTimelineReportHtml(payload); });
  panel.querySelector('.report-actions').addEventListener('click', event => event.stopPropagation());
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function chooseReportOptions({ title, description }){
  const dialog = document.querySelector('#report-options-dialog');
  if (!dialog) return { includeSupporting, includePolicy };
  dialog.querySelector('#report-options-title').textContent = title;
  dialog.querySelector('#report-options-description').textContent = description;
  dialog.querySelector('#report-option-supporting').checked = includeSupporting;
  dialog.querySelector('#report-option-policy').checked = includePolicy;
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'generate') return resolve(null);
      resolve({
        includeSupporting: dialog.querySelector('#report-option-supporting').checked,
        includePolicy: dialog.querySelector('#report-option-policy').checked
      });
    }, { once: true });
    dialog.showModal();
  });
}

async function generateTimelineReport(reportMode = 'direction'){
  if (!timelineReportModeLabel[reportMode]) return;
  const modeLabel = timelineReportModeLabel[reportMode];
  const options = await chooseReportOptions({ title: `${modeLabel} 리포트`, description: '리포트에 포함할 근거 범위를 선택한 뒤 생성을 시작하세요.' });
  if (!options) return;
  const includePolicyInReport = options.includePolicy;
  if (includeSupporting !== options.includeSupporting) {
    includeSupporting = options.includeSupporting;
    [document.querySelector('#include-supporting'), document.querySelector('#include-supporting-compare')].filter(Boolean).forEach(box => { box.checked = includeSupporting; });
    await refreshSupportingViews(document.querySelector('#include-supporting'));
  }
  if (!lastCompanyTimeline?.events?.length) { window.alert('현재 화면에 리포트 근거로 쓸 시계열 이벤트가 없습니다.'); return; }
  const snapshot = lastCompanyTimeline;
  const reportButtons = document.querySelectorAll('[data-timeline-report-mode]');
  reportButtons.forEach(button => { button.disabled = true; });
  showBusy(`${modeLabel} 리포트 생성 중`, `선택한 기업의 현재 화면 이벤트 ${snapshot.events.length}건을 ${modeLabel} 관점으로 읽습니다. 웹 검색은 하지 않습니다.${includePolicyInReport ? ' 정책 연결 판정이 없거나 오래됐으면 먼저 판정해 저장합니다(최대 1분 추가).' : ''} 1분 안팎 걸립니다.`);
  try {
    const response = await fetch('/api/company', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'timeline_report', reportMode, includeSupporting: options.includeSupporting, includePolicy: includePolicyInReport, companyId: snapshot.companyId, events: snapshot.events.map(event => ({ id: event.id, date: event.date, period: periodOf(event.date), track: event.track, layer: event.layer, title: event.title, fact: event.fact, entity: entityLabel(event), sourceName: event.sourceName, sourceUrl: event.sourceUrl, sourceDate: event.sourceDate })) })
    });
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    // 보고서가 방금 판정·저장한 정책 연결을 시간축의 정책 줄에도 바로 반영한다.
    if (Array.isArray(payload.policy_links) && payload.policy_link_status !== 'none') {
      const cached = companyTimelineCache.get(snapshot.companyId);
      if (cached) cached.policyLinks = new Map(payload.policy_links.map(link => [link.policy_id, link]));
    }
    if (currentCompany !== snapshot.companyId) return;
    if (includePolicy && lastCompanyTimeline) renderLayerMatrix(lastCompanyTimeline);
    renderTimelineReportPanel(payload);
  } catch (error) {
    window.alert(`시계열 리포트를 만들지 못했습니다: ${error.message}`);
  } finally {
    hideBusy();
    if (currentCompany === snapshot.companyId) reportButtons.forEach(button => { button.disabled = !lastCompanyTimeline?.events?.length; });
  }
}
// 훑어보는 화면에서 무엇을 먼저 보여줄지 정하는 중요도. 정기보고서와 핵심 등급, 수치가 있는 사실을 앞에 둔다.
function importanceOf(event){
  let score = 0;
  if (event.kind === 'annual_report' || event.kind === 'periodic_report' || event.kind === 'disclosure') score += 3;
  if (event.eligibility === '핵심') score += 2;
  if (event.kind === 'web_backfill') score -= 1;
  if (METRIC_PATTERN.test(`${event.title} ${event.fact}`)) score += 2;
  METRIC_PATTERN.lastIndex = 0;
  if (/(증설|투산|가동|출하|판매|매출|수주|인증|양산|생산능력|공장|투자)/.test(event.title)) score += 1;
  return score;
}
// 사실 문장에서 단위 붙은 수치 두 개까지만 뽑는다. 개조식 한 줄에 실을 핵심이다.
function keyMetrics(event){
  const found = [...String(event.fact || '').matchAll(METRIC_PATTERN)].map(match => match[1].trim());
  return [...new Set(found)].slice(0, 2).join(' · ');
}
function eventTip(event){
  return [event.fact, entityLabel(event) ? `발생 법인: ${entityLabel(event)}` : '', sourceTipText(event)].filter(Boolean).join('\n\n');
}
// 툴팁에는 긴 주소를 넣지 않는다. 누르는 링크는 칸의 '원문'이다.
function sourceTipText(event){
  return `출처: ${event.sourceName}${event.sourceDate ? ` · 발행 ${event.sourceDate}` : ''}`;
}

// 제목이 "매출 134억·순이익 11억·출하 13만 톤·…"처럼 길면 앞 두 토막만 남긴다. 나머지는 툴팁에 있다.
// 회사를 이미 고른 화면에서는 제목 앞의 회사명이 자리만 차지한다. 그 회사의 이름·별칭으로
// 시작하면 걷어낸다. 다른 회사 이름이면 그대로 둔다(누구 얘기인지가 정보이기 때문).
function stripCompanySubject(title, companyId){
  const company = companyById(companyId);
  const source = String(title || '').trim();
  if (!company || !source) return title;
  const bare = String(company.name_ko || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
  const inner = String(company.name_ko || '').match(/\(([^)]+)\)/)?.[1];
  const names = [company.name_ko, company.name_en, company.name_zh, bare, inner]
    .filter(Boolean).map(name => String(name).trim())
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}\\s*(?:의|은|는|이|가)?\\s*[,，·:：\\-–—]?\\s*`, 'i');
    if (!pattern.test(source)) continue;
    const stripped = source.replace(pattern, '').trim();
    if (stripped) return stripped;
  }
  return title;
}
function shortTitle(title){
  const parts = String(title || '').split('·').map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return title;
  let out = parts[0];
  for (const part of parts.slice(1)) { if ((out + part).length > 40) return `${out} …`; out += ` · ${part}`; }
  return out;
}
const DIGEST_PREVIEW = 4;
const DIGEST_ITEM_CHARS = 300;
// 설명이 제목을 그대로 되풀이하며 시작하는 경우가 많다("보고기간 투자액" / "보고기간 투자액은 3,223억…").
// 제목 뒤에 붙은 조사까지 떼고 남은 내용만 돌려준다. 남는 게 없으면 빈 문자열이다(제목만 보여준다).
// 사용자 요청(2026-09-09): 제목과 중복된 앞머리는 없애고 내용은 불릿으로.
const TITLE_PARTICLE = '(?:은|는|이|가|의|을|를|도|에서|으로|로)?';
function factWithoutTitle(title, fact, rawTitle){
  let text = String(fact || '').replace(/\s+/g, ' ').trim();
  for (const head of [String(title || '').trim(), String(rawTitle || '').trim()].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const stripped = text.replace(new RegExp(`^${escaped}\\s*${TITLE_PARTICLE}\\s*[:：,，-]?\\s*`), '');
    if (stripped !== text) { text = stripped; break; }
  }
  return text === String(title || '').trim() ? '' : text;
}
// 남은 설명을 문장 단위 불릿으로. 한 문장이면 불릿 하나다. 300자 상한은 전체 합에 건다.
function digestItemParts(event, companyId){
  const title = stripCompanySubject(event.title, companyId).trim();
  const detail = factWithoutTitle(title, event.displaySummary || event.fact, event.title);
  let budget = DIGEST_ITEM_CHARS - title.length;
  const points = [];
  for (const sentence of splitSentences(detail)) {
    if (budget <= 0) break;
    const clipped = sentence.length > budget ? `${sentence.slice(0, Math.max(0, budget - 1)).trimEnd()}…` : sentence;
    points.push(clipped);
    budget -= clipped.length;
  }
  return { title, points };
}
function digestItemText(event, companyId){
  const { title, points } = digestItemParts(event, companyId);
  return [title, ...points].join('\n');
}
// ── 정량 궤적 ───────────────────────────────────────────────────────────────
// 하나의 연속 시간축을 지표 선과 사건 플래그가 나눠 쓴다. 축은 연도 칸이 아니라 날짜라
// 사건이 실제 '월' 위치에 꽂히고, 플래그에 마우스를 올리면 그 사실이 툴팁으로 뜬다.
// 재료는 정기보고서와 거래소 표준 손익 항목뿐이다(뉴스 제외).
// 화면 라벨은 한국에서 쓰는 계정 이름으로 적는다. 중문 원문 표기(营业利润·扣非…)는
// 툴팁의 '원문 계정'에만 남긴다 — 검산에는 필요하지만 칩에 중국어가 뜨면 읽기 어렵다.
const METRIC_LABELS = {
  revenue_total: '매출', operating_profit: '영업이익', net_profit_attr: '지배주주 순이익',
  net_profit_excl: '순이익(비경상 제외)', net_profit: '순이익', total_profit: '세전이익',
  operating_cost: '매출원가', gross_profit: '매출총이익', rnd_expense: '연구개발비',
  ocf: '영업활동 현금흐름', overseas_revenue: '해외 매출',
};
// 재무 지표는 손익계산서를 위에서 아래로 읽는 순서로 놓는다. 목록을 가나다순이나 데이터 건수순으로
// 놓으면 매출과 매출원가가 떨어져 앉아 "무엇에서 무엇을 뺀 값인지"가 화면에서 사라진다.
//
// rel은 바로 윗 항목과의 관계다. 실제로 성립하는 관계만 적는다 — 화면이 없는 항등식을 만들면
// 사용자가 그것을 근거로 계산한다.
//   'sub'  이 항목을 뺀다(−). 뺄셈 항목이 이것 하나뿐이라는 뜻은 아니다.
//   'eq'   윗 두 줄의 계산 결과다(=). 원문 계정 사이에 항등식이 성립하는 자리에만 쓴다.
//   'next' 중간 항목이 생략된 구간(↓). 영업외손익·법인세처럼 우리가 안 가진 계정이 사이에 있다.
//   'of'   윗 항목의 내역이다(└). 더하거나 빼는 관계가 아니라 쪼갠 것이다.
const PL_ROWS = [
  { metric: 'revenue_total', rel: null, depth: 0 },
  { metric: 'overseas_revenue', rel: 'of', depth: 1 },
  { metric: 'operating_cost', rel: 'sub', depth: 0 },
  // 营业收入 − 营业成本 = 毛利. 원문 계정 사이에 정확히 성립하는 유일한 자리다.
  { metric: 'gross_profit', rel: 'eq', depth: 0 },
  { metric: 'rnd_expense', rel: 'sub', depth: 0 },
  { metric: 'operating_profit', rel: 'next', depth: 0 },
  { metric: 'total_profit', rel: 'next', depth: 0 },
  { metric: 'net_profit', rel: 'next', depth: 0 },
  { metric: 'net_profit_attr', rel: 'of', depth: 1 },
  { metric: 'net_profit_excl', rel: 'of', depth: 1 },
];
// 현금흐름표는 손익계산서와 다른 표다. 같은 줄기에 이어 붙이면 위아래 관계를 오독한다.
const CASHFLOW_ROWS = [{ metric: 'ocf', rel: null, depth: 0 }];
const PL_REL_GLYPH = { sub: '−', eq: '=', next: '↓', of: '└' };
const FINANCIAL_ROWS = [...PL_ROWS, ...CASHFLOW_ROWS];
const MONEY_METRIC_ORDER = FINANCIAL_ROWS.map(row => row.metric);
const FINANCIAL_METRICS = new Set(MONEY_METRIC_ORDER);

// 물량은 종류(출하량·장착량·생산능력)로 묶고, 묶음 안에서는 품목 이름순으로 놓는다.
// 누적·계획은 그 기간의 실적이 아니라 참고 값이라 각 묶음의 뒤로 보낸다.
const VOLUME_KIND_ORDER = ['shipment', 'installed', 'capacity'];
// 물량 지표는 '출하량 · 동력전지'처럼 품목이 붙는다. 품목을 특정하지 못한 값은 추출 단계에서
// 이미 버려지므로 여기 오는 것은 전부 무엇의 물량인지 아는 값이다.
// 누적·계획은 그 기간의 실적이 아니라 참고 값이라 지표를 따로 두고 목록 뒤에 놓는다.
const VOLUME_KIND_LABEL = { shipment: '출하량', installed: '장착량', capacity: '생산능력' };
const VOLUME_BASIS_LABEL = { cum: '누적', plan: '계획' };
const VOLUME_ITEM_LABEL = {
  cathode_lfp: '인산철리튬 양극재', cathode_ncm: '삼원계 양극재', cathode_lco: '코발트산리튬',
  cathode_na: '나트륨 양극재', precursor: '전구체', cathode: '양극재', anode: '음극재',
  ess: 'ESS 전지', power: '동력전지', cell: '리튬이온전지', battery: '전지(품목 미상)',
};
function volumeMetricLabel(metric){
  const match = String(metric).match(/^(shipment|installed|capacity)_(?:(cum|plan)_)?(.+)$/);
  if (!match) return null;
  const [, kind, basis, item] = match;
  const itemLabel = VOLUME_ITEM_LABEL[item];
  if (!itemLabel) return null;
  return `${VOLUME_KIND_LABEL[kind]}${basis ? `(${VOLUME_BASIS_LABEL[basis]})` : ''} · ${itemLabel}`;
}
function metricLabel(metric){ return METRIC_LABELS[metric] || volumeMetricLabel(metric) || metric; }
// 기간 실적을 앞에, 누적·계획은 뒤에 둔다.
function metricSortKey(metric){
  const money = MONEY_METRIC_ORDER.indexOf(metric);
  if (money >= 0) return money;
  return /_(cum|plan)_/.test(metric) ? 200 : 100;
}
function volumeMetricParts(metric){
  const match = String(metric).match(/^(shipment|installed|capacity)_(?:(cum|plan)_)?(.+)$/);
  if (!match) return null;
  const [, kind, basis, item] = match;
  const itemLabel = VOLUME_ITEM_LABEL[item];
  if (!itemLabel) return null;
  return { kind, basis: basis || null, item, itemLabel };
}

// text를 주면 그것으로 적는다. 묶음 안에서는 '출하량 · 동력전지'가 아니라 '동력전지'로 충분하다.
// 묶음 제목이 이미 '출하량'이라 칩마다 되풀이하면 폭만 먹고 읽는 데 도움이 안 된다.
// aria-label에는 항상 전체 이름을 남겨 화면 낭독기에서 묶음 맥락이 사라지지 않게 한다.
function metricChip(metric, current, { extraClass = '', text = null } = {}){
  const on = metric === current;
  const full = metricLabel(metric);
  return `<button type="button" class="traj-chip${extraClass ? ` ${extraClass}` : ''}${on ? ' active' : ''}" data-metric="${escapeHtml(metric)}"${text && text !== full ? ` aria-label="${escapeHtml(full)}"` : ''}${on ? ' aria-current="true"' : ''}>${escapeHtml(text || full)}</button>`;
}

// 좌측 재무(손익계산서 순 세로), 우측 그 외(물량·생산능력 세로). 선택지가 한 줄로 늘어서 있으면
// 매출과 매출원가가 서로 다른 줄에 감겨 관계가 안 보인다.
function metricPickerMarkup(available, current){
  const has = new Set(available);
  const plRows = PL_ROWS.filter(row => has.has(row.metric));
  const cashRows = CASHFLOW_ROWS.filter(row => has.has(row.metric));
  const ladder = (rows) => rows.map(row => `<li class="traj-pl-row depth-${row.depth}">
    <span class="traj-rel${row.rel === 'eq' ? ' exact' : ''}" aria-hidden="true">${row.rel ? PL_REL_GLYPH[row.rel] : ''}</span>
    ${metricChip(row.metric, current)}
  </li>`).join('');

  const volumes = available.filter(metric => !FINANCIAL_METRICS.has(metric))
    .map(metric => ({ metric, parts: volumeMetricParts(metric) }))
    .filter(entry => entry.parts);
  const groups = VOLUME_KIND_ORDER.map(kind => {
    const items = volumes.filter(entry => entry.parts.kind === kind)
      .sort((a, b) => (a.parts.basis ? 1 : 0) - (b.parts.basis ? 1 : 0) || a.parts.itemLabel.localeCompare(b.parts.itemLabel, 'ko'));
    if (!items.length) return '';
    return `<div class="traj-group"><p class="traj-group-title">${escapeHtml(VOLUME_KIND_LABEL[kind])}</p>
      <ul class="traj-list">${items.map(entry => `<li>${metricChip(entry.metric, current, {
        extraClass: 'volume',
        // 묶음 제목이 종류를 말하므로 칩에는 품목만 적는다. 누적·계획만 앞에 표시를 남긴다.
        text: `${entry.parts.basis ? `(${VOLUME_BASIS_LABEL[entry.parts.basis]}) ` : ''}${entry.parts.itemLabel}`,
      })}</li>`).join('')}</ul></div>`;
  }).filter(Boolean).join('');
  const groupBox = groups ? `<div class="traj-groups">${groups}</div>` : '';

  // 두 열을 하나로 묶어 돌려주지 않는다. 호출자가 차트 좌우에 하나씩 놓기 때문이다.
  // 재무는 왼쪽, 그 외는 오른쪽. 사이에 그래프가 들어간다.
  return {
    financial: `<section class="traj-col traj-col-left" aria-label="재무 지표">
      <p class="traj-col-title">재무 · 손익계산서 순</p>
      ${plRows.length ? `<ul class="traj-pl">${ladder(plRows)}</ul>` : '<p class="traj-empty">이 회사는 손익 항목이 없습니다.</p>'}
      ${cashRows.length ? `<p class="traj-col-title sub">현금흐름표</p><ul class="traj-pl">${ladder(cashRows)}</ul>` : ''}
      ${(() => {
        const hasExact = plRows.some(row => row.rel === 'eq');
        const hasGap = plRows.some(row => row.rel === 'next');
        if (!hasExact && !hasGap) return '';
        return `<p class="traj-col-note">${hasExact ? '<b><span class="traj-rel exact">=</span> 정확히 성립</b><br>' : ''}${hasGap ? '<b><span class="traj-rel">↓</span> 중간 계정 생략</b><br>영업외손익·법인세처럼 우리가 갖고 있지 않은 계정이 사이에 있습니다. ' : ''}화면은 값을 계산하지 않고 공시에 적힌 값만 보여 줍니다.</p>`;
      })()}
    </section>`,
    other: `<section class="traj-col traj-col-right" aria-label="물량과 생산능력">
      <p class="traj-col-title">물량 · 생산능력</p>
      ${groupBox || '<p class="traj-empty">이 회사는 물량 지표가 없습니다.</p>'}
    </section>`,
  };
}

// 좌우 메뉴가 세로로 길어지면서 그래프 위아래에 빈 공간만 남았다(2026-09-08 사용자 지적).
// SVG는 폭 기준으로 크기가 정해지고 높이는 viewBox 비율을 그대로 따르므로, 메뉴가 길어져도
// 그래프는 커지지 않았다.
//
// 고정 비율을 키우는 것으로는 회사마다 다른 메뉴 길이를 따라갈 수 없고, preserveAspectRatio를
// 풀어 늘이면 점과 플래그가 타원으로 찌그러진다. 그래서 좌표계의 세로 길이를 실제 칸 높이에
// 맞춰 다시 잡는다 — 폭과 높이의 배율이 같아지므로 원은 원으로 남고, 늘어난 높이는 전부
// 꺾은선이 그려지는 영역이 가져간다.
const TRAJ = { width: 1000, plotTop: 26, plotHeight: 108, axisY: 146, laneGap: 14, height: 232, padX: 46 };
// 축 아래(플래그·연도 라벨)가 쓰는 세로 예산. 이만큼은 높이가 변해도 그대로 두고,
// 남는 높이는 플롯이 가져간다. 그래야 점 크기·글자 크기가 회사마다 달라지지 않는다.
const TRAJ_BELOW_PLOT = TRAJ.height - TRAJ.plotHeight;
function trajGeometry(height){
  const plotHeight = Math.max(60, height - TRAJ_BELOW_PLOT);
  return { ...TRAJ, height: plotHeight + TRAJ_BELOW_PLOT, plotHeight, axisY: TRAJ.plotTop + plotHeight + 12 };
}
// 직전에 측정해 둔 좌표계 높이. 다음 렌더의 첫 추정값으로 써서 두 번 그리는 깜빡임을 줄인다.
let trajectoryViewHeight = null;
// 칸 크기가 바뀌면(창 크기, 글꼴 적재, 다른 지표로 메뉴 길이가 달라짐) 좌표계를 다시 맞춘다.
// requestAnimationFrame은 탭이 가려져 있으면 오지 않아 첫 맞춤을 놓친다(2026-09-08 실측).
// ResizeObserver는 그리기와 무관하게 배치가 정해지면 부른다.
let trajectoryTimeline = null;
let trajectoryPlotObserver = null;
// 축에 기본으로 담는 연도 수. 재무 데이터는 2011년치까지 있으나 사건 플래그는 2023년부터라,
// 전부 펼치면 최근 흐름이 왼쪽 빈 구간에 눌린다. 전체 보기는 버튼으로 연다.
const TRAJ_RECENT_YEARS = 4;
let trajectoryMetric = null;
// 기본은 연간이다. 분기는 누적이라 한 해 안에서 네 점이 계단처럼 올라가는데, 처음 보는 화면이
// 그 모양이면 실적이 계속 늘어나는 것처럼 읽힌다. 연간으로 흐름을 먼저 보이고 분기는 토글로 연다.
let trajectoryQuarterly = false;
let trajectoryCurrency = 'CNY';
let trajectoryFullRange = false;

// 기간 표기를 그 구간의 마지막 날로 바꾼다. 연간 값을 1월에 찍으면 시간축에서 앞당겨진다.
function periodEndDate(period){
  const match = String(period || '').match(/^(\d{4})(?:(H[12])|(Q[1-4]))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? (match[2] === 'H1' ? 6 : 12) : match[3] ? Number(match[3][1]) * 3 : 12;
  return { time: Date.UTC(year, month, 0), year: match[1], part: match[2] || match[3] || null, interim: Boolean(match[2] || match[3]) };
}
const PERIOD_CAPTION = { Q1: '1분기', H1: '상반기', Q3: '3분기', Q4: '4분기', H2: '하반기', Q2: '2분기' };
// 중국 공시의 분기·반기 실적은 연초부터의 누적이라 '누적'을 붙인다. 다만 계획값은 누적이 아니라
// 그 보고서 시점에 밝힌 목표라, 같은 말을 붙이면 첫 줄부터 실적으로 읽힌다.
function periodLabel(row){
  const plan = /_plan_/.test(String(row.metric || ''));
  if (!row.at.part) return `${row.at.year} ${plan ? '시점' : '연간'}`;
  const part = PERIOD_CAPTION[row.at.part] || row.at.part;
  return `${row.at.year} ${part} ${plan ? '시점' : '누적'}`;
}
const isMoney = (row) => row.unit === 'CNY_100M';
function metricValueText(row, currency, rate){
  const value = convertedValue(row, currency, rate);
  if (value === null) return '';
  // 물량은 통화 전환 대상이 아니다. 톤은 만 톤으로 줄여 읽고 GWh는 그대로 쓴다.
  if (!isMoney(row)) {
    if (row.unit === 't') {
      const inTenK = value / 10000;
      return inTenK >= 1
        ? `${inTenK.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}만 톤`
        : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}톤`;
    }
    return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${row.unit || ''}`;
  }
  const digits = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const shown = value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency === 'USD' ? `$${shown}억` : `${shown}억 위안`;
}
// 환산은 표시용이다. 원래 통화 값과 쓰인 환율을 툴팁에 같이 남겨 검산할 수 있게 한다.
// 물량(GWh·톤)은 통화가 아니므로 환율을 대지 않는다.
function convertedValue(row, currency, rate){
  const value = Number(row.value);
  if (!Number.isFinite(value)) return null;
  if (currency !== 'USD' || !isMoney(row)) return value;
  return rate && rate > 0 ? value / rate : null;
}
// 툴팁을 한 줄로 이어 붙이면 읽히지 않는다. 머리줄과 항목줄로 나눈다.
// 어느 보고서에서 나온 값인지. 특히 계획값은 '언제 세운 계획인지'가 값 자체만큼 중요하다.
// 2026년 보고서가 밝힌 계획과 2022년 보고서가 밝힌 같은 문장은 전혀 다른 정보다.
//
// report_kind는 이벤트의 evidence_kind를 그대로 받아 'annual_report' / 'periodic_report' 두 값이다
// (2026-09-08 운영 DB 확인: 173행 / 139행). 반기·분기는 거기 없고 period('2026H1', '2025Q3')에
// 있다. 연도도 occurred_at이 아니라 period에서 읽는다 — 연차보고서의 사건일이 이듬해 1월로
// 찍힌 행이 있어(1건) occurred_at의 해는 회계연도와 어긋날 수 있다.
const REPORT_KIND_LABEL = { annual_report: '연차보고서', annual: '연차보고서', semiannual: '반기보고서', quarterly: '분기보고서' };
function sourceReportLabel(row){
  const period = String(row.period || '').match(/^(\d{4})(H[12]|Q[1-4])?$/);
  const year = period ? period[1] : String(row.report_at || '').slice(0, 4);
  const hasYear = /^\d{4}$/.test(year);
  const kindKey = String(row.report_kind || '');
  // 사전 조회는 자기 키만 본다. 'constructor' 같은 값이 오면 Object의 함수가 문자열로 찍힌다.
  let kind = Object.hasOwn(REPORT_KIND_LABEL, kindKey) ? REPORT_KIND_LABEL[kindKey] : '';
  if (!kind && kindKey === 'periodic_report') {
    const part = period?.[2] || '';
    kind = part.startsWith('H') ? '반기보고서' : part.startsWith('Q') ? '분기보고서' : '정기보고서';
  }
  if (!hasYear && !kind) return '';
  return `${hasYear ? `${year}년 ` : ''}${kind || '정기보고서'}`;
}
// 원래 값은 1차 추출·교차검증을 거친 값이다. 웹 검증이 찾은 다른 출처는 덮어쓰지 않고 따로 적는다.
function alternativeTipText(alternatives){
  if (!alternatives?.length) return '';
  return ['다른 근거(웹 검증 · 원래 값은 유지)', ...alternatives.slice(0, 3).map(alt => `· ${alt.claim_ko}\n  출처 ${alt.source_url}${alt.created_at ? ` · ${String(alt.created_at).slice(0, 10)}` : ''}`)].join('\n');
}
function alternativeLinks(alternatives){
  return (alternatives || []).slice(0, 3).map(alt =>
    ` <a class="alt-evidence" href="${escapeHtml(alt.source_url)}" target="_blank" rel="noreferrer" data-tip="${escapeHtml(alternativeTipText([alt]))}">다른 근거</a>`).join('');
}
function metricTip(row, currency, rate){
  const lines = [`${periodLabel(row)}  ${metricValueText(row, currency, rate)}`, ''];
  if (currency === 'USD' && rate) {
    lines.push(`원래 값   ${Number(row.value).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억 위안`);
    lines.push(`적용 환율  ${rate.toFixed(4)} CNY/USD (기간 평균)`);
  }
  lines.push(`원문 계정  ${row.line_item_zh}`);
  if (row.quantity_text) lines.push(`원문 표기  ${row.quantity_text}`);
  if (row.yoy_pct_stated !== null && row.yoy_pct_stated !== undefined) {
    const yoy = Number(row.yoy_pct_stated);
    lines.push(`전년 동기  ${yoy > 0 ? '+' : ''}${yoy}%`);
  }
  const report = sourceReportLabel(row);
  lines.push(`출처      ${row.verified ? `거래소 데이터 · ${report || '보고서'} 원문과 일치`
    : row.source_kind === 'market' ? '거래소 표준 손익 항목'
    : report ? `${report} 원문 발췌` : '보고서 원문 발췌'}`);
  // 계획·누적은 그 기간의 실적이 아니다. 어느 시점에 밝힌 것인지 붙이지 않으면 실적과 같은
  // 축에 찍힌 점이 무엇인지 구분되지 않는다.
  const basis = String(row.metric).match(/_(cum|plan)_/)?.[1];
  if (basis === 'plan') lines.push(`계획값     ${report ? `${report}가 밝힌 계획` : '보고서가 밝힌 계획'}입니다. 그 기간의 실적이 아닙니다.`);
  if (basis === 'cum') lines.push(`누적값     ${report ? `${report} 기준` : '보고서 기준'} 누적치입니다. 그 기간의 실적이 아닙니다.`);
  if (row.alternatives?.length) lines.push('', alternativeTipText(row.alternatives));
  return lines.join('\n');
}
function clipText(text, limit){
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}
// 제목과 사실은 같은 내용을 다르게 줄인 것이라 그대로 이어 붙이면 같은 말이 두 번 나온다.
// 사실이 제목으로 시작하면 제목을 빼고, 길이도 잘라 툴팁이 화면을 덮지 않게 한다.
function trajectoryFlagTip(event, companyId){
  const title = clipText(stripCompanySubject(event.title, companyId), 70);
  const fact = clipText(event.fact, 200);
  const head = `${event.date}  ${evidenceLabels[event.kind] || ''}`;
  const overlaps = fact && title && fact.startsWith(title.replace(/…$/, '').slice(0, 20));
  return [head, '', ...(overlaps ? [fact] : [title, fact].filter(Boolean))].join('\n');
}
// 두 출처를 한 줄로 합친다. 거래소 표준 항목이 기본이고(전 기간·전 계정), 같은 칸에 보고서
// 발췌값이 있으면 대조해 '원문 확인' 표시를 단다. 값이 어긋나면 그 사실을 툴팁에 남긴다.
function mergeMetricSources(timeline){
  const excerpts = new Map();
  for (const row of timeline.metrics || []) excerpts.set(`${row.period} ${row.metric}`, row);
  const rows = [];
  const used = new Set();
  for (const row of timeline.financials || []) {
    const key = `${row.period} ${row.metric}`;
    const excerpt = excerpts.get(key);
    used.add(key);
    const value = Number(row.value);
    const matched = excerpt && Math.abs(Number(excerpt.value) - value) / Math.max(1e-9, Math.abs(value)) < 0.001;
    rows.push({
      period: row.period, metric: row.metric, value, unit: row.unit, currency: row.currency,
      line_item_zh: row.item_zh, quantity_text: excerpt?.quantity_text || null,
      yoy_pct_stated: row.yoy_pct ?? null, source_kind: 'market', verified: Boolean(matched),
      // 대조에 쓴 발췌가 어느 보고서에서 왔는지도 남긴다. '원문과 일치'가 어느 원문인지
      // 밝히지 않으면 확인했다는 말만 남고 확인할 방법이 없다.
      report_kind: excerpt?.report_kind || null, report_at: excerpt?.occurred_at || null,
      source_url: excerpt?.source_url || null,
    });
  }
  // 거래소 데이터에 없는 항목(해외 매출·영업활동 현금흐름 등)은 발췌 쪽에만 있다. 그것도 싣는다.
  for (const [key, row] of excerpts.entries()) {
    if (used.has(key)) continue;
    rows.push({
      period: row.period, metric: row.metric, value: Number(row.value), unit: row.unit, currency: row.currency,
      line_item_zh: row.line_item_zh, quantity_text: row.quantity_text,
      yoy_pct_stated: row.yoy_pct_stated ?? null, source_kind: 'excerpt', verified: false,
      report_kind: row.report_kind || null, report_at: row.occurred_at || null, source_url: row.source_url || null,
    });
  }
  const altByCell = new Map();
  for (const alt of timeline.alternatives || []) {
    if (alt.target_kind !== 'metric') continue;
    const key = `${alt.period} ${alt.metric}`;
    altByCell.set(key, [...(altByCell.get(key) || []), alt]);
  }
  for (const row of rows) row.alternatives = altByCell.get(`${row.period} ${row.metric}`) || [];
  return rows;
}
// 재무 자동 갱신은 야간 크론이 주기적으로 돌린다. 실패하거나 한동안 돌지 않았으면 화면에
// 그 사실을 적는다 — 낡은 값을 조용히 최신인 척 보여 주지 않기 위해서다.
const FINANCIAL_STALE_DAYS = 14;
function financialFreshnessWarning(status){
  if (!status) return '재무 데이터 자동 갱신 기록이 없습니다. 아래 값은 마지막으로 채워진 시점 기준입니다.';
  const at = new Date(status.at);
  const days = Number.isNaN(at.getTime()) ? null : Math.floor((Date.now() - at.getTime()) / 86400000);
  const when = Number.isNaN(at.getTime()) ? '' : ` (마지막 시도 ${at.toISOString().slice(0, 10)})`;
  if (status.status === 'failed') return `재무 데이터 자동 갱신이 실패했습니다${when}. 아래 값은 그 이전에 채워진 것입니다.`;
  if (status.status === 'partial') {
    const names = (status.failed || []).map(item => item.company_id).filter(Boolean);
    return `재무 데이터 자동 갱신이 일부만 성공했습니다${when}. 못 받은 대상: ${names.length ? names.join(', ') : '일부'}.`;
  }
  if (days !== null && days > FINANCIAL_STALE_DAYS) return `재무 데이터가 ${days}일째 갱신되지 않았습니다${when}.`;
  return '';
}
// 그려진 그래프의 실제 칸 높이를 재어 좌표계를 맞춘다. 어긋남이 작으면 아무것도 하지 않으므로
// 다시 그리기가 스스로 멈춘다 — 좌표계를 맞추면 그래프의 고유 높이가 곧 칸 높이가 되어
// 다음 측정에서 같은 값이 나온다.
function refitTrajectory(timeline){
  const target = document.querySelector('#trajectory');
  const plotBox = target?.querySelector('.traj-plot');
  const svgBox = target?.querySelector('.traj-svg');
  if (!plotBox || !svgBox) return;
  const boxWidth = svgBox.getBoundingClientRect().width;
  const boxHeight = plotBox.getBoundingClientRect().height;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return;
  const wanted = Math.round(TRAJ.width * boxHeight / boxWidth);
  const current = Number(String(svgBox.getAttribute('viewBox') || '').split(' ')[3]) || TRAJ.height;
  if (Math.abs(wanted - current) <= 2) return;
  trajectoryViewHeight = wanted;
  renderTrajectory(timeline);
}

// 그래프 칸의 크기 변화를 따라간다. 다시 그릴 때마다 칸이 새로 만들어지므로 매번 다시 붙인다.
function observeTrajectoryPlot(target, timeline){
  if (typeof ResizeObserver !== 'function') return;
  trajectoryPlotObserver?.disconnect();
  const plotBox = target.querySelector('.traj-plot');
  if (!plotBox) return;
  trajectoryPlotObserver = new ResizeObserver(() => refitTrajectory(timeline));
  trajectoryPlotObserver.observe(plotBox);
}

function renderTrajectory(timeline){
  const section = document.querySelector('#trajectory-block');
  const target = document.querySelector('#trajectory');
  if (!section || !target) return;
  // 좌표계 세로 길이. 직전 측정값이 있으면 그것으로 그려 다시 그리는 일을 줄인다.
  const G = trajGeometry(trajectoryViewHeight || TRAJ.height);
  const all = mergeMetricSources(timeline)
    .map(row => ({ ...row, at: periodEndDate(row.period) }))
    .filter(row => row.at && Number.isFinite(Number(row.value)));
  if (!all.length) {
    // 정기보고서도 거래소 데이터도 없는 회사(비상장)는 아래 사실 카드만 쓴다. 빈 차트를 두지 않는다.
    section.hidden = true;
    target.innerHTML = '';
    return;
  }
  section.hidden = false;
  const rates = new Map((timeline.fx || []).map(row => [row.period, Number(row.rate_avg)]));
  const available = [...new Set(all.map(row => row.metric))]
    .filter(metric => METRIC_LABELS[metric] || volumeMetricLabel(metric))
    .sort((a, b) => metricSortKey(a) - metricSortKey(b) || a.localeCompare(b));
  if (!available.includes(trajectoryMetric)) trajectoryMetric = available[0];

  let rows = all.filter(row => row.metric === trajectoryMetric).sort((a, b) => a.at.time - b.at.time);
  if (!trajectoryQuarterly) rows = rows.filter(row => !row.at.interim || Number(row.at.year) > Math.max(...rows.filter(item => !item.at.interim).map(item => Number(item.at.year)), -Infinity));
  // USD로 볼 때 그 기간 환율이 없으면 점을 만들지 않는다. 환산 못 한 값을 위안화로 섞으면
  // 축이 뒤섞여 크기를 오독한다.
  // 환율이 없는 기간은 달러로 못 그린다. 물량(GWh·톤)은 통화가 아니라 이 필터 대상이 아니다.
  if (trajectoryCurrency === 'USD') rows = rows.filter(row => !isMoney(row) || rates.get(row.period) > 0);
  const years = [...new Set(all.map(row => row.at.year))].sort();
  const cutoff = trajectoryFullRange ? years[0] : years.slice(-TRAJ_RECENT_YEARS)[0];
  rows = rows.filter(row => row.at.year >= cutoff);
  if (!rows.length) {
    target.innerHTML = `<p class="traj-note">선택한 조건에 표시할 값이 없습니다.</p>`;
    return;
  }

  const flags = (timeline.events || [])
    .filter(event => (event.kind === 'annual_report' || event.kind === 'periodic_report') && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.date.slice(0, 4) >= cutoff)
    .map(event => ({ event, time: Date.UTC(Number(event.date.slice(0, 4)), Number(event.date.slice(5, 7)) - 1, Number(event.date.slice(8, 10))) }))
    .sort((a, b) => a.time - b.time);

  // 연간 값을 12월 31일에 찍으면 그 해 구간의 오른쪽 끝, 즉 다음 해 경계에 붙어 선다.
  // 2025년 매출이 2026 칸에 걸쳐 보이는 것이 그래서다. 연간 실적은 12월 31일 하루가 아니라
  // 그 해 전체의 값이므로 연간 모드에서는 그 해 가운데에 찍는다.
  // 분기 모드에서는 그대로 기간 끝에 둔다 — Q1·H1·Q3가 누적으로 쌓이는 순서가 흐트러지면 안 된다.
  const pointTime = (row) => (!trajectoryQuarterly && !row.at.interim)
    ? Date.UTC(Number(row.at.year), 6, 1)
    : row.at.time;
  // 시간축은 지표와 사건을 모두 담는다. 한쪽만 담으면 두 층의 x가 어긋난다.
  const times = [...rows.map(pointTime), ...flags.map(flag => flag.time)];
  const minTime = Math.min(...times), maxTime = Math.max(...times);
  const span = Math.max(1, maxTime - minTime);
  const plotWidth = G.width - G.padX * 2;
  const x = (time) => G.padX + ((time - minTime) / span) * plotWidth;

  const valueOf = (row) => convertedValue(row, trajectoryCurrency, rates.get(row.period));
  const values = rows.map(valueOf).filter(value => value !== null);
  const top = Math.max(0, ...values), bottom = Math.min(0, ...values);
  const range = (top - bottom) || 1;
  const y = (value) => G.plotTop + G.plotHeight - ((value - bottom) / range) * G.plotHeight;
  const zeroY = y(0);

  // 분기 값은 누적(YTD)이라 해가 바뀌면 1분기부터 다시 쌓인다. 한 줄로 이으면 매년 초에
  // 뚝 떨어지는 톱니가 된다. 단일분기로 바꾸려면 뺄셈이 필요한데 그것은 우리가 만든 값이라
  // 하지 않는다. 대신 연도 경계에서 선을 끊어 해마다 자기 곡선을 갖게 한다.
  const segments = [];
  for (const row of rows) {
    const last = segments[segments.length - 1];
    if (last && last.year === row.at.year) last.rows.push(row);
    else segments.push({ year: row.at.year, rows: [row] });
  }
  // 연간만 볼 때는 해마다 점이 하나라 끊으면 선이 사라진다. 그때는 한 줄로 잇는다.
  // 연간 모드에서도 마지막 연간 이후의 당해 누적은 성격이 다르다. 확정된 연간 사이는 실선,
  // 2025 연말에서 2026 분기 누적으로 넘어가는 구간은 점선으로 이어 확정 전임을 표시한다.
  const annualPoints = rows.filter(row => !row.at.interim);
  const tailPoints = rows.filter(row => row.at.interim);
  const path = (list) => list.map((row, index) => `${index ? 'L' : 'M'}${x(pointTime(row)).toFixed(1)} ${y(valueOf(row)).toFixed(1)}`).join(' ');

  const point = (row, showLabel) => {
    const value = valueOf(row);
    if (value === null) return '';
    const cx = x(pointTime(row)), cy = y(value);
    const shape = row.at.interim
      ? `<rect x="${(cx - 3).toFixed(1)}" y="${(cy - 3).toFixed(1)}" width="6" height="6" transform="rotate(45 ${cx.toFixed(1)} ${cy.toFixed(1)})" class="traj-dot interim"/>`
      : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" class="traj-dot${row.verified ? ' verified' : ''}"/>`;
    const anchor = cx > G.width - G.padX - 30 ? 'end' : cx < G.padX + 30 ? 'start' : 'middle';
    return `<g class="traj-point" data-tip="${escapeHtml(metricTip(row, trajectoryCurrency, rates.get(row.period)))}"><rect x="${(cx - 13).toFixed(1)}" y="${(cy - 13).toFixed(1)}" width="26" height="26" fill="transparent"/>${shape}${showLabel ? `<text x="${cx.toFixed(1)}" y="${(cy - 9).toFixed(1)}" class="traj-point-label" text-anchor="${anchor}">${escapeHtml(metricValueText(row, trajectoryCurrency, rates.get(row.period)))}${row.alternatives?.length ? ' *' : ''}</text>` : ''}</g>`;
  };

  // 정기보고서 사건은 결산일에 몰린다. 같은 날·같은 트랙이면 점 하나로 묶고 건수를 적는다.
  const laneRows = 2;
  const cluster = (list) => {
    const byDate = new Map();
    for (const item of list) {
      if (!byDate.has(item.event.date)) byDate.set(item.event.date, { time: item.time, date: item.event.date, events: [] });
      byDate.get(item.event.date).events.push(item.event);
    }
    const lastX = new Array(laneRows).fill(-Infinity);
    return [...byDate.values()].sort((a, b) => a.time - b.time).map(group => {
      const px = x(group.time);
      let row = lastX.findIndex(previous => px - previous > 22);
      if (row < 0) row = lastX.indexOf(Math.min(...lastX));
      lastX[row] = px;
      return { ...group, px, row };
    });
  };
  const marketFlags = cluster(flags.filter(flag => flag.event.track !== 'tech'));
  const techFlags = cluster(flags.filter(flag => flag.event.track === 'tech'));
  const CLUSTER_TIP_MAX = 5;
  const clusterTip = (group) => {
    if (group.events.length === 1) return trajectoryFlagTip(group.events[0], timeline.companyId);
    const shown = group.events.slice(0, CLUSTER_TIP_MAX);
    const rest = group.events.length - shown.length;
    return [
      `${group.date}  ${evidenceLabels[group.events[0].kind] || ''} ${group.events.length}건`, '',
      ...shown.map(event => `· ${clipText(stripCompanySubject(event.title, timeline.companyId), 46)}`),
      rest > 0 ? `  외 ${rest}건 — 눌러서 전부 보기` : '\n눌러서 근거 보기',
    ].join('\n');
  };
  const flagMark = (group, track, baseY) => {
    const py = baseY + group.row * G.laneGap;
    const many = group.events.length > 1;
    return `<g class="traj-flag ${track}${many ? ' many' : ''}" data-tip="${escapeHtml(clusterTip(group))}" data-flag-date="${escapeHtml(group.date)}" data-flag-track="${track}" tabindex="0">
      <line x1="${group.px.toFixed(1)}" y1="${G.axisY}" x2="${group.px.toFixed(1)}" y2="${(py - 4).toFixed(1)}"/>
      <circle cx="${group.px.toFixed(1)}" cy="${py.toFixed(1)}" r="${many ? 6 : 4.2}"/>
      ${many ? `<text x="${group.px.toFixed(1)}" y="${(py + 2.6).toFixed(1)}" class="traj-flag-count">${group.events.length}</text>` : ''}
      <circle cx="${group.px.toFixed(1)}" cy="${py.toFixed(1)}" r="11" fill="transparent"/>
    </g>`;
  };
  const marketBase = G.axisY + 12;
  const techBase = marketBase + laneRows * G.laneGap + 8;
  // 사건이 없는 트랙도 레인 이름은 남긴다. 점만 그리면 기술 사건이 없는 기간에는
  // 아래 줄 자체가 사라진 것처럼 보여 시장·기술 두 축을 구분하기 어렵다.
  const laneLabels = `<g class="traj-lane-labels" aria-hidden="true">
    <text x="${G.padX - 16}" y="${(marketBase + 3).toFixed(1)}" text-anchor="end">시장</text>
    <text x="${G.padX - 16}" y="${(techBase + 3).toFixed(1)}" text-anchor="end">기술</text>
  </g>`;

  // 선은 그 해가 시작되는 1월 1일에, 라벨은 그 해 구간의 가운데에 둔다.
  // 둘을 같은 자리에 두면 12월 31일에 찍히는 연간 값 바로 오른쪽에 다음 해 라벨이 서서,
  // 2025년 연간 매출 아래에 '2026'이 적히는 것처럼 보인다.
  const yearTicks = [];
  const firstYear = new Date(minTime).getUTCFullYear(), lastYear = new Date(maxTime).getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year += 1) {
    const boundary = Date.UTC(year, 0, 1);
    if (boundary > minTime && boundary < maxTime) {
      yearTicks.push(`<g class="traj-tick"><line x1="${x(boundary).toFixed(1)}" y1="${G.plotTop}" x2="${x(boundary).toFixed(1)}" y2="${G.height - 14}"/></g>`);
    }
    const bandStart = Math.max(minTime, boundary);
    const bandEnd = Math.min(maxTime, Date.UTC(year + 1, 0, 1));
    if (bandEnd <= bandStart) continue;
    const left = x(bandStart), right = x(bandEnd);
    // 연간 값은 12월 31일에 찍혀 그 해 구간의 오른쪽 끝에 선다. 구간을 한 해씩 걸러 옅게 칠해
    // 그 점이 어느 해에 속하는지 선 하나로 판단하지 않아도 되게 한다.
    if (year % 2 === 0) yearTicks.push(`<rect class="traj-band" x="${left.toFixed(1)}" y="${G.plotTop}" width="${(right - left).toFixed(1)}" height="${G.height - 14 - G.plotTop}"/>`);
    // 구간이 좁으면 라벨이 옆 라벨과 겹친다. 그런 해는 적지 않는다.
    if (right - left < 34) continue;
    // 그 해의 값이 화면에 있으면 라벨을 그 값 바로 아래에 둔다. 축 양 끝의 해는 구간이 잘려
    // 가운데가 밀리는데, 그러면 값과 연도가 어긋나 보인다.
    const anchorRow = rows.find(row => row.at.year === String(year) && !row.at.interim) || rows.find(row => row.at.year === String(year));
    const labelX = anchorRow ? x(pointTime(anchorRow)) : (left + right) / 2;
    yearTicks.push(`<g class="traj-tick"><text x="${Math.min(Math.max(labelX, left + 12), right - 12).toFixed(1)}" y="${G.height - 3}">${year}</text></g>`);
  }

  const label = metricLabel(trajectoryMetric);
  const picker = metricPickerMarkup(available, trajectoryMetric);
  // 재무 자동 갱신이 실패했거나 오래 안 돌았으면 그 사실을 화면에 적는다. 조용히 낡은 값을
  // 보여 주면 사용자가 그것을 최신으로 믿는다.
  const warning = financialFreshnessWarning(timeline.financialsStatus);
  // 물량은 통화 전환 대상이 아니라 스위치를 감추고 단위를 대신 적는다.
  const showCurrency = rows.some(isMoney);
  const missingRate = trajectoryCurrency === 'USD' && all.filter(row => row.metric === trajectoryMetric && row.at.year >= cutoff).length > rows.length;
  target.innerHTML = `${warning ? `<p class="traj-warn" role="status">${escapeHtml(warning)}</p>` : ''}<div class="traj-head"><p class="traj-current">보는 지표 <strong>${escapeHtml(label)}</strong></p>
    <div class="traj-toggles">
      <div class="traj-switch" role="group" aria-label="표시 단위"><button type="button" data-toggle="quarterly" class="${trajectoryQuarterly ? 'on' : ''}">분기</button><button type="button" data-toggle="annual" class="${trajectoryQuarterly ? '' : 'on'}">연간</button></div>
      ${showCurrency ? `<div class="traj-switch" role="group" aria-label="통화"><button type="button" data-currency="CNY" class="${trajectoryCurrency === 'CNY' ? 'on' : ''}">CNY</button><button type="button" data-currency="USD" class="${trajectoryCurrency === 'USD' ? 'on' : ''}">USD</button></div>` : `<span class="traj-unit-note">단위 ${escapeHtml(rows[0].unit === 't' ? '만 톤' : rows[0].unit)}</span>`}
      ${years.length > TRAJ_RECENT_YEARS ? `<button type="button" class="traj-range" data-toggle="range">${trajectoryFullRange ? `최근 ${TRAJ_RECENT_YEARS}년만` : `전체 기간(${years[0]}~)`}</button>` : ''}
    </div></div>
    <div class="traj-stage">${picker.financial}<div class="traj-plot">
    <svg class="traj-svg" viewBox="0 0 ${G.width} ${G.height}" role="img" aria-label="${escapeHtml(label)} 시계열과 정기보고서 사건 플래그">
      ${yearTicks.join('')}
      ${bottom < 0 ? `<line class="traj-zero" x1="${G.padX}" y1="${zeroY.toFixed(1)}" x2="${G.width - G.padX}" y2="${zeroY.toFixed(1)}"/>` : ''}
      <line class="traj-axis-line" x1="${G.padX - 12}" y1="${G.axisY}" x2="${G.width - G.padX + 12}" y2="${G.axisY}"/>
      ${trajectoryQuarterly
        ? `${segments.slice(1).map((segment, index) => `<path class="traj-line link" d="${path([segments[index].rows.at(-1), segment.rows[0]])}"/>`).join('')}${segments.filter(segment => segment.rows.length > 1).map(segment => `<path class="traj-line" d="${path(segment.rows)}"/>`).join('')}`
        : `${tailPoints.length && annualPoints.length ? `<path class="traj-line link" d="${path([annualPoints.at(-1), ...tailPoints])}"/>` : ''}${annualPoints.length > 1 ? `<path class="traj-line" d="${path(annualPoints)}"/>` : ''}`}
      ${rows.map((row, index) => point(row, !trajectoryQuarterly || !row.at.interim || index === rows.length - 1)).join('')}
      ${laneLabels}
      ${marketFlags.map(item => flagMark(item, 'market', marketBase)).join('')}
      ${techFlags.map(item => flagMark(item, 'tech', techBase)).join('')}
    </svg></div>${picker.other}</div>
    <p class="traj-note">가로축은 날짜, 선은 <strong>${escapeHtml(label)}</strong>입니다. ${trajectoryQuarterly
      ? '중국 공시의 분기 실적은 <strong>연초부터의 누적</strong>이라 해가 바뀌면 1분기부터 다시 쌓입니다. 그래서 해마다 실선을 따로 그리고 <strong>연도가 바뀌는 구간만 점선</strong>으로 이었습니다. 단일 분기 값은 우리가 빼서 만들지 않습니다.'
      : '연간 확정치를 실선으로 잇고, 아직 연간이 나오지 않은 <strong>당해 누적치는 점선</strong>으로 그 끝에 이어 붙입니다.'}
      축 아래 점은 그 달에 공시된 사건입니다(위 줄 시장 · 아래 줄 기술). 점에 마우스를 올리면 내용과 원문 계정이 보이고, 누르면 근거가 아래에 열립니다.
      ${trajectoryCurrency === 'USD' && showCurrency ? '달러 값은 <strong>그 기간의 평균 환율</strong>(유럽중앙은행 기준)로 환산한 표시용 값이며, 원래 위안화 값과 적용 환율은 각 점의 툴팁에 있습니다.' : ''}
      ${missingRate ? '환율이 없는 기간은 표시하지 않았습니다.' : ''}</p>
    <div id="traj-detail" class="traj-detail" hidden></div>`;

  target.querySelectorAll('.traj-chip').forEach(button => button.addEventListener('click', () => {
    trajectoryMetric = button.dataset.metric;
    renderTrajectory(timeline);
  }));
  target.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.toggle;
    if (mode === 'quarterly' || mode === 'annual') trajectoryQuarterly = mode === 'quarterly';
    if (mode === 'range') trajectoryFullRange = !trajectoryFullRange;
    renderTrajectory(timeline);
  }));
  target.querySelectorAll('[data-currency]').forEach(button => button.addEventListener('click', () => {
    trajectoryCurrency = button.dataset.currency;
    renderTrajectory(timeline);
  }));
  const detail = target.querySelector('#traj-detail');
  const detailCard = (event) => `<article class="traj-detail-item">
    <h4>${escapeHtml(stripCompanySubject(event.title, timeline.companyId))}</h4>
    <p class="traj-detail-meta">${escapeHtml(displayDate(event))} · ${escapeHtml(evidenceLabels[event.kind] || '')}${event.sourceUrl ? ` · <a href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문 ↗</a>` : ''}</p>
    ${(() => { const points = splitSentences(factWithoutTitle(stripCompanySubject(event.title, timeline.companyId), event.fact, event.title)); return points.length ? `<ul class="digest-points">${points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''; })()}
    ${event.excerpt ? `<blockquote>${escapeHtml(String(event.excerpt).slice(0, 400))}</blockquote>` : ''}
  </article>`;
  target.querySelectorAll('.traj-flag').forEach(node => node.addEventListener('click', () => {
    if (!detail) return;
    const date = node.dataset.flagDate, track = node.dataset.flagTrack;
    const picked = flags.filter(item => item.event.date === date && (item.event.track === 'tech' ? 'tech' : 'market') === track).map(item => item.event);
    if (!picked.length) return;
    target.querySelectorAll('.traj-flag').forEach(other => other.classList.remove('active'));
    node.classList.add('active');
    detail.hidden = false;
    detail.innerHTML = `${picked.length > 1 ? `<p class="traj-detail-count">${escapeHtml(date)} · ${picked.length}건</p>` : ''}${picked.map(detailCard).join('')}`;
  }));

  // 칸 높이는 좌우 메뉴 중 더 긴 쪽이 정하는데, 그 메뉴도 방금 이 함수가 함께 그렸다.
  // 그래서 좌표계를 미리 알 수 없다 — 그린 뒤에 재서 맞춘다. 대개 이 한 번으로 끝나고,
  // 나중에 칸이 달라지면 관찰자가 따라잡는다.
  trajectoryTimeline = timeline;
  observeTrajectoryPlot(target, timeline);
  refitTrajectory(timeline);
}

function renderCompanyEvents(timeline){
  const grid = document.querySelector('#snapshot-grid');
  grid.className = 'snapshot-grid digest-stack';
  const events = visibleEvents(timeline).filter(event => event.kind === 'annual_report' || event.kind === 'periodic_report');
  if (!events.length) {
    grid.innerHTML = `<p>${escapeHtml(timelineNotice(timeline.status) || '아직 읽어들인 정기보고서가 없습니다. 매일 밤 수집 뒤 자동으로 채워집니다.')}</p>`;
    return;
  }
  // 보고서(시점)마다 카드 하나. 시장 다음 기술 순서로 세로 배치하고, 각 사실은 300자까지 직접 보여준다.
  const groups = new Map();
  [...events].sort((a, b) => b.date.localeCompare(a.date)).forEach(event => {
    const label = displayDate(event);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(event);
  });
  const line = event => {
    const { title, points } = digestItemParts(event, timeline.companyId);
    return `<li class="digest-line" data-tip="${escapeHtml(eventTip(event))}"><span class="digest-title">${escapeHtml(title)}</span>${points.length ? `<ul class="digest-points">${points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}</li>`;
  };
  const column = (name, list, cls) => {
    if (!list.length) return '';
    const shown = list.slice(0, DIGEST_PREVIEW), rest = list.slice(DIGEST_PREVIEW);
    return `<div class="digest-col ${cls}"><h4>${name} <small>${list.length}</small></h4><ul class="digest-lines">${shown.map(line).join('')}</ul>${rest.length ? `<ul class="digest-lines digest-more" hidden>${rest.map(line).join('')}</ul><button type="button" class="digest-toggle">+${rest.length}건 더보기</button>` : ''}</div>`;
  };
  const card = ([label, items]) => {
    const first = items[0];
    const sorted = [...items].sort((x, y) => importanceOf(y) - importanceOf(x));
    const market = sorted.filter(event => event.track !== 'tech'), tech = sorted.filter(event => event.track === 'tech');
    const source = items.find(event => event.sourceUrl);
    return `<article class="digest-report"><header><span class="digest-period" data-tip="${escapeHtml(dateTip(first))}">${escapeHtml(label)}</span><span>${escapeHtml(evidenceLabels[first.kind] || '')}</span><span>사실 ${items.length}건</span>${source ? `<a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noreferrer">원문 ↗</a>` : ''}</header><div class="digest-body">${column('시장', market, 'market')}${column('기술', tech, 'tech')}</div></article>`;
  };
  // 연도별로 접었다 펼친다. 가장 최근 연도만 펼쳐 두고 나머지는 접는다.
  const years = new Map();
  for (const entry of groups.entries()) {
    const year = entry[1][0].date.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(entry);
  }
  grid.innerHTML = [...years.entries()].map(([year, entries], index) => {
    const count = entries.reduce((sum, [, items]) => sum + items.length, 0);
    // 위 궤적이 흐름을 보여 주므로 아래 사실 카드는 기본으로 접어 둔다. 필요할 때만 펼친다.
    return `<details class="digest-year"><summary><span class="digest-year-label">${escapeHtml(year)}년</span><span class="digest-year-meta">보고서 ${entries.length}건 · 사실 ${count}건</span></summary><div class="digest-year-body">${entries.map(card).join('')}</div></details>`;
  }).join('');
  grid.querySelectorAll('.digest-toggle').forEach(button => button.addEventListener('click', () => {
    button.previousElementSibling.hidden = false;
    button.remove();
  }));
}
// 시간은 위(최근)→아래(과거)로 흐르고, 왼쪽이 시장·오른쪽이 기술이다. 레이어 8개는 화면에서 2+2로 묶는다.
// 데이터의 layer_key는 그대로 8개다. 묶음은 표시용이라 언제든 되돌릴 수 있다.
const MATRIX_GROUPS = [
  { track: 'market', label: '실적·생산기반', layers: ['supply-performance', 'investment-production'] },
  { track: 'market', label: '고객·해외', layers: ['customer-commercialization', 'regional-overseas'] },
  { track: 'tech', label: '소재·공정', layers: ['technology-material-chemistry', 'technology-process-performance'] },
  { track: 'tech', label: 'IP·인증·양산', layers: ['technology-ip-standard', 'technology-development'] },
];
function renderLayerMatrix(timeline){
  const target = document.querySelector('#dual-track');
  const events = visibleEvents(timeline);
  const policies = includePolicy ? (timeline.policies || []) : [];
  const notice = timelineNotice(timeline.status);
  if (!events.length && !policies.length) {
    target.innerHTML = `<p>${escapeHtml(notice || '선택한 기업에 표시할 공시 기반 이벤트가 아직 없습니다.')}</p>`;
    return;
  }
  const periods = timelinePeriods([...events, ...policies]).slice().reverse();
  // 미분류는 트랙만 알 수 있으므로 그 트랙의 첫 묶음에 넣고 '미분류' 표시를 단다.
  const groupOf = event => {
    const found = MATRIX_GROUPS.find(group => group.layers.includes(event.layer));
    if (found) return found;
    return MATRIX_GROUPS.find(group => group.track === (event.track === 'tech' ? 'tech' : 'market'));
  };
  const cell = (group, period) => {
    const matched = events.filter(event => groupOf(event) === group && periodOf(event.date) === period).sort((x, y) => importanceOf(y) - importanceOf(x));
    if (!matched.length) return `<span style="color:#9aa7b6" title="${EMPTY_CELL_NOTE}">—</span>`;
    return matched.map(event => {
      const tip = [event.fact, `레이어: ${event.label}`, entityLabel(event) ? `발생 법인: ${entityLabel(event)}` : '', sourceTipText(event), alternativeTipText(event.alternatives)].filter(Boolean).join('\n\n');
      const unclassified = event.layer === UNCLASSIFIED_LAYER ? '<span class="matrix-entity">미분류</span>' : '';
      // 표는 빠르게 훑는 영역이므로 제목 아래에는 한 개의 짧은 핵심 불릿만 둔다.
      // 전체 근거와 수치는 기존 툴팁·원문 링크에서 확인할 수 있다.
      const displayTitle = shortTitle(stripCompanySubject(event.title, timeline.companyId || currentCompany));
      const detailPoints = splitSentences(factWithoutTitle(displayTitle, event.displaySummary || event.fact, event.title))
        .map(point => point.replace(/^[\s•·\-–—]+/, '').trim())
        .filter(Boolean)
        .slice(0, 1);
      // 보조 데이터는 제목만 두고 요약 줄은 툴팁으로 보낸다. 켜면 칸이 길어져 핵심 사실이 밀린다.
      const detail = isPrimaryEvidence(event) && detailPoints.length
        ? `<ul class="matrix-details">${detailPoints.map(point => `<li>${escapeHtml(clipText(point, 64))}</li>`).join('')}</ul>` : '';
      // 공시·검증 통과 사실과 보조(참고) 데이터를 글자색으로 구분한다.
      const supporting = isPrimaryEvidence(event) ? '' : ' is-supporting';
      return `<div class="matrix-item${supporting}" data-tip="${escapeHtml(tip)}"><span class="matrix-title">${escapeHtml(displayTitle)}</span>${detail}${unclassified}${entityLabel(event) ? `<span class="matrix-entity">${escapeHtml(entityLabel(event))}</span>` : ''}${event.sourceUrl ? ` <a class="matrix-src" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ''}${alternativeLinks(event.alternatives)}</div>`;
    }).join('');
  };
  const head = MATRIX_GROUPS.map(group => `<th class="matrix-head ${group.track}">${group.label}</th>`);
  const body = periods.map(period => {
    // 셀에도 축 클래스를 달아 시장·기술 절반이 배경색으로 갈리게 한다.
    const cells = MATRIX_GROUPS.map(group => `<td class="matrix-cell ${group.track}">${cell(group, period)}</td>`);
    const policy = policyCell(policies, period, timeline.policyLinks);
    return `<tr>${cells[0]}${cells[1]}<th class="matrix-period">${period}</th>${cells[2]}${cells[3]}</tr>${policy ? `<tr class="policy-inline-row"><td colspan="5">${policy}</td></tr>` : ''}`;
  }).join('');
  target.innerHTML = `<div class="matrix-scroll" style="overflow-x:auto"><table class="matrix-table"><colgroup><col class="matrix-layer-col"><col class="matrix-layer-col"><col class="matrix-time-col"><col class="matrix-layer-col"><col class="matrix-layer-col"></colgroup><thead><tr><th class="matrix-track market" colspan="2">시장</th><th></th><th class="matrix-track tech" colspan="2">기술</th></tr><tr>${head[0]}${head[1]}<th class="matrix-period-head">시점</th>${head[2]}${head[3]}</tr></thead><tbody>${body}</tbody></table></div><p style="margin:10px 0 0;color:#617187;font-size:12px">위가 최근, 아래로 갈수록 과거입니다. 지난 연도는 상·하반기, 당해 연도는 분기로 나눕니다. 왼쪽 두 칸이 시장(실적·생산기반 / 고객·해외), 오른쪽 두 칸이 기술(소재·공정 / IP·인증·양산)입니다. 정책은 해당 시점 아래 한 줄로 간추려 표시하며, 마우스를 올리면 전체 내용을 볼 수 있습니다. 빈 칸(—)은 그 구간에 ${EMPTY_CELL_NOTE}을 뜻하며 사건이 없었다는 뜻이 아닙니다.</p>`;
}

// 벡터 지식에 질문한다. 근거가 없으면 답을 만들지 않고 무엇을 확인할지 안내받는다.
async function askKnowledge(event){
  event.preventDefault();
  const input = document.querySelector('#ask-input');
  const button = document.querySelector('#ask-submit');
  const target = document.querySelector('#ask-result');
  const question = input.value.trim();
  if (question.length < 2) return;
  const scoped = document.querySelector('#ask-scope-company').checked && currentCompany;
  // 검증된 기사·이벤트·Daily는 기본 검색 대상이다. 이 옵션은 본문 검증 전 헤드라인까지 넓힌다.
  const includeUnverified = document.querySelector('#ask-include-unverified').checked;
  button.disabled = true; button.textContent = '찾는 중…';
  target.innerHTML = '<p class="ask-empty">근거를 검색하고 있습니다…</p>';
  try {
    const result = await fetch('/api/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, companyId: scoped ? currentCompany : null, includeUnverified })
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error([payload.status, payload.message].filter(Boolean).join(' · ') || `HTTP ${result.status}`);
    target.innerHTML = renderAskResult(payload, scoped);
  } catch (error) {
    target.innerHTML = `<p class="ask-empty">${escapeHtml(`답변을 가져오지 못했습니다: ${error.message}`)}</p>`;
  } finally {
    button.disabled = false; button.textContent = '찾기';
  }
}
function renderAskResult(payload, scoped){
  const parts = [];
  const unverified = payload.unverified_matched || 0;
  const providerRows = payload.provider_metric_matched || 0;
  const gradeNote = (unverified ? ` (그중 미검증 헤드라인 ${unverified}건)` : '')
    + (providerRows ? ` (거래소 집계값·원문 발췌 없음 ${providerRows}건 포함)` : '');
  // 하이브리드 검색이 무엇을 얼마나 건졌는지 밝힌다. 단어 검색이 없었으면 근거가 얇은 이유가
  // 질문 탓인지 색인 탓인지 사용자가 구분할 수 없다.
  const r = payload.retrieval;
  const hybridNote = !r ? ''
    : r.lexical_available === false ? ` 단어 검색은 색인이 준비되지 않아 건너뛰었고 의미 검색 결과만 씁니다.`
    : r.vector_available === false ? ` 의미 검색(임베딩)이 응답하지 않아 단어 검색 ${r.lexical_matched}건만 씁니다. 뜻이 비슷한 표현은 이번 결과에서 빠져 있습니다.`
    : ` 의미 검색 ${r.vector_matched}건 + 단어 검색 ${r.lexical_matched}건을 합쳐 후보 ${r.candidates}건, 그중 ${r.overlapped}건은 양쪽에 모두 걸렸습니다.`;
  // 정량 사전조회가 발동했으면 그것부터 밝힌다. 검색이 아니라 표에서 바로 읽은 값이라는 뜻이다.
  const metricNote = r?.metric_rows ? ` 회사·지표를 짚은 질문이라 정량 표에서 ${r.metric_rows}칸을 먼저 읽어 근거 앞에 두었습니다.` : '';
  const rewriteNote = r?.rewritten ? ` 1차 근거가 부족해 검색 질의 ${r.rewritten_queries?.length || 0}개로 한 번 더 검색했습니다.` : '';
  const scopeNote = (scoped ? `${displayName(currentCompany)} 근거 ${payload.matched}건에서 찾았습니다.` : `전체 기업 근거 ${payload.matched}건에서 찾았습니다.`) + gradeNote + metricNote + hybridNote + rewriteNote;
  if (payload.sufficient && payload.answer_ko) {
    parts.push(`<p class="ask-answer">${escapeHtml(payload.answer_ko)}</p>`);
  }
  if (payload.conflicts_ko) {
    parts.push(`<div class="ask-block"><p class="ask-label conflict">상충하는 근거</p><p class="ask-answer">${escapeHtml(payload.conflicts_ko)}</p></div>`);
  }
  if (payload.guidance_ko) {
    parts.push(`<div class="ask-block"><p class="ask-label guide">${payload.sufficient ? '더 확인할 것' : '근거가 부족합니다 · 확인할 것'}</p><p class="ask-answer">${escapeHtml(payload.guidance_ko)}</p></div>`);
  }
  if (payload.completeness_warning) {
    parts.push(`<div class="ask-block"><p class="ask-label conflict">PDF 완전성 경고</p><p class="ask-answer">${escapeHtml(payload.completeness_warning)}</p></div>`);
  }
  if (payload.sources?.length) {
    const items = payload.sources.map(source => {
      const head = [displayName(source.company_id), source.published_at, source.source_name].filter(Boolean).join(' · ');
      const link = source.source_url ? ` <a href="${escapeHtml(source.source_url)}" target="_blank" rel="noreferrer">원문</a>` : '';
      // 본문 대조를 거치지 않은 근거는 눈에 띄게 구분한다. 사실과 헤드라인이 섞여 읽히면 안 된다.
      // 정량 행은 보고서 발췌가 있는 것과 거래소 집계값(발췌 없음)을 나눠 보인다. 사용자 결정(2026-09-09):
      // 발췌 없는 값도 근거로 쓰되 등급을 숨기지 않는다.
      const grade = source.verified === false ? ' <span class="ask-grade">미검증 헤드라인</span>'
        : source.metric_grade === 'provider' ? ' <span class="ask-grade provider">거래소 집계값 · 원문 발췌 없음</span>'
        : source.metric_grade === 'excerpt' ? ' <span class="ask-grade excerpt">보고서 발췌</span>' : '';
      // 어느 검색기가 찾았는지. 양쪽에 걸린 근거가 가장 믿을 만하고, 단어 검색만 찾은 근거는
      // 의미 검색으로는 못 건졌을 것이라 하이브리드가 무슨 일을 했는지 그대로 드러난다.
      const by = source.retrieved_by || [];
      const route = by[0] === 'metric' ? ' <span class="ask-route metric">정량 조회</span>'
        : by.length > 1 ? ' <span class="ask-route both">의미+단어</span>'
        : by[0] === 'lexical' ? ' <span class="ask-route lex">단어 검색</span>'
        : by[0] === 'vector' ? ' <span class="ask-route vec">의미 검색</span>' : '';
      return `<li><span class="n">${source.n}</span>${escapeHtml(head)}${grade}${route}${link}<br>${escapeHtml(source.excerpt)}</li>`;
    }).join('');
    parts.push(`<div class="ask-block"><p class="ask-label">근거 ${payload.sources.length}건</p><ul class="ask-sources">${items}</ul></div>`);
  }
  parts.push(`<p class="ask-empty" style="margin-top:10px">${escapeHtml(scopeNote)}</p>`);
  return parts.join('');
}

async function exportCompanyTimeline(){
  if (!currentCompany) { window.alert('내보낼 기업이 선택되지 않았습니다.'); return; }
  const company = companyById(currentCompany);
  const timeline = await loadCompanyTimeline(currentCompany);
  const events = visibleEvents(timeline);
  if (!events.length) { window.alert(timelineNotice(timeline.status) || '내보낼 이벤트가 없습니다.'); return; }
  const rows = [['회사', '발생 법인', '근거', '구분', '레이어', '시기', '발생 시점', '시점 정밀도', '주요 사실', '상세', '지역', '시계열 등급', '출처', '출처 링크', '원문 발췌', '원문 한국어 번역']];
  [...events].sort((a, b) => a.date.localeCompare(b.date)).forEach(event => {
    rows.push([company.name_ko, entityLabel(event), evidenceLabels[event.kind] || event.kind, event.group, event.label, periodOf(event.date) || event.date.slice(0, 4), displayDate(event), event.precision, event.title, event.fact, event.region, event.eligibility, event.sourceName, event.sourceUrl, event.excerpt, event.excerptKo]);
  });
  // 그래프는 거래소 표준 재무 데이터와 보고서 발췌를 같은 기간·지표 기준으로 합쳐 쓴다.
  // Excel은 병합 전 API 원본 행을 모두 담는다. 같은 값이 두 번 있어도 출처가 다르면 보존해야
  // 화면에서 선택하지 않은 지표·기간·원문 발췌가 빠지지 않는다.
  const financialRows = [['회사', '회계연도', '회계기간', '지표', '값', '단위', '통화', '원문 계정', '전년 대비', '데이터 출처', '보고서 종류', '보고서일', '회계 기준·제공자', '출처 링크', '원문 표기·금액']];
  const quantitativeRecords = [
    ...(timeline.financials || []).map(row => ({
      ...row, lineItem: row.item_zh, yoy: row.yoy_pct, sourceLabel: '거래소 표준 재무', reportKind: row.report_type,
      reportDate: row.report_date, sourceDetail: [row.account_standard, row.source].filter(Boolean).join(' · '), sourceUrl: '', rawText: row.raw_amount,
    })),
    ...(timeline.metrics || []).map(row => ({
      ...row, lineItem: row.line_item_zh, yoy: row.yoy_pct_stated, sourceLabel: '보고서 원문 발췌', reportKind: row.report_kind,
      reportDate: row.occurred_at, sourceDetail: '', sourceUrl: row.source_url, rawText: row.quantity_text || row.excerpt || '',
    })),
  ];
  quantitativeRecords
    .sort((a, b) => String(a.period).localeCompare(String(b.period)) || metricLabel(a.metric).localeCompare(metricLabel(b.metric), 'ko') || a.sourceLabel.localeCompare(b.sourceLabel, 'ko'))
    .forEach(row => financialRows.push([
      company.name_ko, Number(String(row.period).slice(0, 4)), row.period, metricLabel(row.metric), Number(row.value),
      row.unit === 'CNY_100M' ? '억 위안' : row.unit || '', row.currency || '', row.lineItem || '',
      row.yoy === null || row.yoy === undefined ? '' : Number(row.yoy) / 100, row.sourceLabel, row.reportKind || '',
      row.reportDate || '', row.sourceDetail, row.sourceUrl || '', row.rawText || '',
    ]));
  if (window.XLSX) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{wch:20}, {wch:30}, {wch:14}, {wch:8}, {wch:18}, {wch:10}, {wch:12}, {wch:30}, {wch:70}, {wch:14}, {wch:12}, {wch:20}, {wch:55}, {wch:55}, {wch:55}];
    rows.slice(1).forEach((row, index) => { const cell = sheet[`M${index + 2}`]; if (cell && row[12]) cell.l = { Target: row[12] }; });
    const financialSheet = XLSX.utils.aoa_to_sheet(financialRows);
    financialSheet['!cols'] = [{wch:20}, {wch:10}, {wch:12}, {wch:24}, {wch:18}, {wch:12}, {wch:12}, {wch:28}, {wch:14}, {wch:20}, {wch:18}, {wch:14}, {wch:28}, {wch:60}, {wch:38}];
    financialRows.slice(1).forEach((row, index) => {
      const value = financialSheet[`E${index + 2}`]; if (value) value.z = '#,##0.00';
      const yoy = financialSheet[`I${index + 2}`]; if (yoy && row[8] !== '') yoy.z = '0.0%';
      const source = financialSheet[`N${index + 2}`]; if (source && row[13]) source.l = { Target: row[13] };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기업 시계열');
    XLSX.utils.book_append_sheet(workbook, financialSheet, '정량 정보');
    XLSX.writeFile(workbook, `${currentCompany}_timeline.xlsx`);
    return;
  }
  const table = rows.map((row, index) => `<tr>${row.map(value => `<${index ? 'td' : 'th'}>${escapeHtml(value)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('');
  const blob = new Blob([`<html><head><meta charset="utf-8"></head><body><table border="1">${table}</table></body></html>`], {type:'application/vnd.ms-excel;charset=utf-8'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${currentCompany}_timeline.xls`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
async function exportRawNews(){
  const button = document.querySelector('#export-raw-news'); button.disabled = true; button.textContent = '다운로드 준비 중…';
  try {
    const result = await fetch('/api/raw-news'); const payload = await result.json();
    if (!result.ok) throw new Error('raw_export_failed');
    const rows = [['기사 ID','회사','기업 유형','원문 제목','한국어 제목','발행일','매체','원문 링크','한국어 요약','키워드','상태','출처 등급','Top 10','순위']];
    (payload.articles || []).forEach(article => {
      // article_company가 빈 배열이면(회사 매칭 전) truthy라서 그냥 두면 forEach가 아무 일도 안 하고
      // 그 기사가 통째로 빠진다. length로 판정해야 빈 배열도 폴백을 탄다.
      const links = article.article_company?.length ? article.article_company : [{company_id:'', company:{}}];
      links.forEach(link => rows.push([article.id, link.company?.name_ko || link.company_id, (link.company?.type_tags || []).join(', '), article.title_original, article.title_ko, article.published_at, article.source_name, article.canonical_url, article.summary_ko, (article.keywords_ko || []).join(', '), article.verification_status, article.source_tier, article.is_top10 ? 'Y' : '', article.top10_rank || '']));
    });
    if (window.XLSX) {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      // SheetJS의 !cols는 숫자 너비 목록이 아니라 ColInfo 객체 배열이다. hidden을 명시해
      // Excel이 열을 숨김 상태로 해석하지 않도록 한다.
      sheet['!cols'] = [{wch:36, hidden:false}, {wch:18, hidden:false}, {wch:14, hidden:false}, {wch:60, hidden:false}, {wch:50, hidden:false}, {wch:20, hidden:false}, {wch:20, hidden:false}, {wch:70, hidden:false}, {wch:70, hidden:false}, {wch:35, hidden:false}, {wch:18, hidden:false}, {wch:18, hidden:false}, {wch:10, hidden:false}, {wch:8, hidden:false}];
      rows.slice(1).forEach((row, index) => { sheet[`H${index + 2}`].l = { Target: row[7] }; });
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Raw articles'); XLSX.writeFile(workbook, `china-battery-lens_raw_${new Date().toISOString().slice(0,10)}.xlsx`);
    } else {
      const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const table = rows.map((row, index) => `<tr>${row.map((value, column) => column === 7 && index ? `<td><a href="${escape(value)}">${escape(value)}</a></td>` : `<${index ? 'td' : 'th'}>${escape(value)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('');
      const blob = new Blob([`<html><head><meta charset="utf-8"></head><body><table border="1">${table}</table></body></html>`], {type:'application/vnd.ms-excel;charset=utf-8'});
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `china-battery-lens_raw_${new Date().toISOString().slice(0,10)}.xls`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }
  } catch { window.alert('Raw data Excel을 만들지 못했습니다.'); }
  finally { button.disabled = false; button.textContent = 'Raw data Excel'; }
}
// 비교 리포트를 A4 한 장으로 인쇄용 창에 띄운다.
// 서버가 PDF 바이트를 만들지 않는 이유는 한글 PDF에 CJK 폰트를 통째로 실어야 하기 때문이다.
// 브라우저 인쇄는 시스템 폰트를 그대로 쓰므로 한글이 깨지지 않고, 사용자가 PDF로 저장할 수 있다.
// 정책-기업 연결 웹 재검토 결과. 직접·간접은 근거(회사 사실 또는 연 문서)가 있어야 서버가 남긴다.
const POLICY_RELATION_LABEL = { direct: '직접', indirect: '간접', none: '무관', undetermined: '판정불가' };
function policyLinksHtml(r, payload){
  if (r.policy_check_status === 'failed') return '<p class="none">정책–기업 연결 판정에 실패해 이 리포트에는 정책을 넣지 않았습니다.</p>';
  const links = Array.isArray(r.policy_links) ? r.policy_links : [];
  if (!links.length) return r.policy_check_status === 'ok' ? '<p class="none">두 회사 사건과 연결 경로가 판정된 정책이 없어 정책을 넣지 않았습니다.</p>' : '';
  const order = { direct: 0, indirect: 1, undetermined: 2, none: 3 };
  const rows = [...links].sort((x, y) => (order[x.relation] ?? 9) - (order[y.relation] ?? 9)).map(link => {
    const who = link.company === 'B' ? payload.company_b : payload.company_a;
    const basis = [
      link.basis_title ? `회사 사실: ${link.basis_date ? `${link.basis_date} ` : ''}${link.basis_title}` : '',
      link.source_url ? `<a href="${escapeHtml(link.source_url)}" target="_blank" rel="noreferrer">출처 문서 ↗</a>` : '',
    ].filter(Boolean);
    return `<li><span class="tag">${escapeHtml(POLICY_RELATION_LABEL[link.relation] || '판정불가')}</span> <strong>${escapeHtml(link.policy_title)}</strong> <small>${escapeHtml(link.policy_date || '')}</small> · ${escapeHtml(who || '')}<br><span>${escapeHtml(link.path_ko)}</span>${basis.length ? `<br><span class="basis">${basis.map(part => part.startsWith('<a ') ? part : escapeHtml(part)).join(' · ')}</span>` : ''}</li>`;
  }).join('');
  // 2026-09-11 이전 리포트는 웹 재검토 결과(출처 문서 포함)를 저장했고, 이후는 회사 사건 기반 추론이다.
  const inferred = links.every(link => !link.source_url);
  return `<p class="who" style="margin-top:4px">정책–기업 연결 ${inferred ? '(회사 사건을 출발점으로 한 추론)' : '재검토 (웹 검색)'}</p><ul>${rows}</ul>`;
}
function compareReportParts(payload){
  const r = payload.report || {};
  const insight = r.korea_insight || {};
  const check = r.verification || {};
  const db = payload.db_updates || {};
  const pair = payload.pair_context || null;
  const A = escapeHtml(payload.company_a), B = escapeHtml(payload.company_b);
  const traj = r.trajectory || {};
  const cmp = r.comparison || {};
  const pairLite = r.pair_lite || {};
  const bulletText = value => {
    const rawLines = String(value || '').split(/\r?\n|•/).map(line => line.trim()).filter(Boolean);
    const numbered = rawLines.length > 1 && rawLines.every(line => /^\d+[.)]\s*/.test(line));
    const lines = rawLines.map(line => line.replace(/^(?:[-*+]\s*|\d+[.)]\s*)/, '')).filter(Boolean);
    return lines.length > 1
      ? `<${numbered ? 'ol' : 'ul'} class="report-bullets">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</${numbered ? 'ol' : 'ul'}>`
      : `<span>${escapeHtml(lines[0] || '')}</span>`;
  };
  // 1단계: 각 회사의 시장·기술 궤적을 회사별로 보여준다. 2단계 비교는 그 아래에 축별로 묶는다.
  const trajCard = (who, node) => `
    <div class="col"><p class="who">${who}</p>
    <div class="txt"><span class="axis-tag market">시장</span>${bulletText(node?.market_ko)}</div>
    <div class="txt"><span class="axis-tag tech">기술</span>${bulletText(node?.technology_ko)}</div></div>`;
  const cmpRow = (label, key) => cmp?.[key] ? `<div class="contrast"><span class="tag">${label}</span>${bulletText(cmp[key])}</div>` : '';
  const points = (insight.points || []).map(item => `
    <div class="point"><div class="lead"><span class="seg">${escapeHtml(item.segment || '')}</span>${bulletText(item.implication_ko)}</div>
    <div class="txt">${bulletText(item.point_ko)}</div><div class="basis">근거 · ${bulletText(item.basis_ko)}</div></div>`).join('');
  const fixes = (check.corrections || []).map(item => {
    // 날짜 교정은 이벤트 시점을 고치고, 수치·주체 교정은 원래 값을 두고 다른 근거로 붙인다.
    // db_action이 없는 옛 히스토리는 예전 규칙(날짜만 반영)으로 읽는다.
    const action = item.db_action || (item.field === 'occurred_at' && item.event_id ? 'date_fixed' : 'report_only');
    const dbNote = action === 'date_fixed' ? ' · DB 이벤트 시점 수정 반영'
      : action === 'alternative_added' ? ' · 원래 값은 유지하고 다른 근거로 DB에 병기'
      : ' · 리포트 본문만 수정(DB 미반영)';
    return `<li><span class="was">${escapeHtml(item.original_ko || '')}</span><span class="now">${escapeHtml(item.corrected_ko || '')}</span><span class="basis">${escapeHtml(item.reason_ko || '')}${dbNote}</span></li>`;
  }).join('');
  const added = (check.added_evidence || []).map(item => `
    <li><strong>${escapeHtml(item.company === 'B' ? payload.company_b : payload.company_a)}</strong> · ${escapeHtml(item.occurred_at || '')} · ${escapeHtml(item.fact_ko || '')}<span class="basis">${escapeHtml(item.source_name || '')} · <a href="${escapeHtml(item.source_url || '')}">${escapeHtml(item.source_url || '')}</a></span></li>`).join('');
  const stamp = new Date(payload.generated_at || Date.now()).toLocaleString('ko-KR');
  // 검증이 실패한 리포트는 "대조했는데 고칠 게 없었다"와 구분해야 한다. 둘 다 수정 목록이 비어 있지만,
  // 실패는 아직 아무것도 대조하지 않은 상태다. 같은 문구를 쓰면 검증을 통과한 리포트로 읽힌다.
  const verifyFailed = payload.verification_status === 'draft_only';
  const dbLine = verifyFailed
    ? '웹 검증에 실패해 초안 상태입니다.'
    : `DB 반영 · 시점 수정 ${db.dates_fixed || 0}건 · 참고 이벤트 추가 ${db.events_added || 0}건`;
  const styles = `
@page{size:A4;margin:13mm 14mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Malgun Gothic","Noto Sans KR","Segoe UI",sans-serif;font-size:10.4px;line-height:1.68;color:#14263d}
header{border-bottom:2px solid #10365f;padding-bottom:6px;margin-bottom:9px}
.eyebrow{margin:0;font-size:8px;font-weight:800;letter-spacing:1.1px;color:#1674c5}
h1{margin:2px 0 4px;font-size:20px;letter-spacing:-.35px;color:#10365f}
.meta{margin:0;font-size:8.2px;color:#617187}
.headline{margin:0 0 10px;padding:8px 11px;border-left:4px solid #10365f;background:#f3f6fa;font-size:11.2px;font-weight:800}
.pair-lite-report{margin:0 0 8px;padding:7px 9px;border:1px solid #cbdceb;border-radius:6px;background:#f8fbfe}
.pair-lite-report h2{margin:0 0 5px}
.pair-lite-report dl{display:grid;grid-template-columns:1fr 1fr;margin:0;border-top:1px solid #dbe6ef;border-left:1px solid #dbe6ef}
.pair-lite-row{display:grid;grid-template-columns:72px minmax(0,1fr);border-right:1px solid #dbe6ef;border-bottom:1px solid #dbe6ef}
.pair-lite-row dt{padding:4px 5px;background:#edf4fa;font-size:8px;font-weight:800;color:#10365f}
.pair-lite-row dd{margin:0;padding:4px 5px;font-size:8.4px;word-break:keep-all}
.report-bullets{display:inline-block;margin:1px 0 1px 14px;padding-left:8px;vertical-align:top}
.report-bullets li{margin:0 0 2px}
.axis-tag{display:inline-block;margin-right:5px;padding:0 5px;border-radius:8px;font-size:7.6px;font-weight:800;vertical-align:1px;color:#fff}
.axis-tag.market{background:#236aa6}.axis-tag.tech{background:#8b5a10}
.col .txt{margin:0 0 4px}
h2{margin:14px 0 7px;padding-top:7px;border-top:1px solid #dbe3ec;font-size:13.2px;color:#10365f;letter-spacing:.15px}
h2.tech-h{color:#8b5a10}h2.insight{color:#8b5a10}h2.check{color:#0c6b4e}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.col{padding:6px 8px;border:1px solid #dbe3ec;border-radius:6px}
.who{margin:0 0 3px;font-size:9.6px;font-weight:800;color:#1674c5}
.txt{margin:0}
.contrast{margin:5px 0 0;padding:5px 8px;background:#eaf3fb;border-radius:6px}
.tag{display:inline-block;margin-right:6px;padding:0 6px;border-radius:9px;background:#10365f;color:#fff;font-size:7.8px;font-weight:800;vertical-align:1px}
.point{margin:0 0 6px;padding:5px 8px;border:1px solid #e4dcc8;border-radius:6px;background:#fffdf6}
.lead{margin:0 0 3px;font-weight:800;color:#5a3d0a}
.seg{display:inline-block;margin-right:5px;padding:0 5px;border:1px solid #e4dcc8;border-radius:9px;font-size:7.8px;font-weight:800;color:#8b5a10;background:#fff;vertical-align:1px}
.basis{display:block;margin-top:2px;font-size:8.2px;color:#617187}
ul{margin:0;padding-left:12px}li{margin-bottom:3px}
.was{display:block;color:#9b3a3a;text-decoration:line-through}
.now{display:block;font-weight:700}
.none{margin:0;font-size:8.8px;color:#617187}
a{color:#1674c5;text-decoration:none;word-break:break-all}strong{color:#1674c5;font-weight:800;background:#edf5ff;padding:0 1px;border-radius:2px}
footer{margin-top:9px;padding-top:5px;border-top:1px solid #dbe3ec;font-size:7.8px;color:#617187}
@media screen{body{max-width:186mm;margin:18px auto;padding:0 14px}}
`;
  const pairNote = pair ? `<p class="coverage-note">비교 관계 · ${escapeHtml(pair.mode || 'X')} / ${escapeHtml(pair.label_ko || '')}<br>A 근거 ${pair.coverage_a?.total || 0}건(시장 ${pair.coverage_a?.market || 0} · 기술 ${pair.coverage_a?.tech || 0}, ${escapeHtml(pair.coverage_a?.earliest || '미상')}~${escapeHtml(pair.coverage_a?.latest || '미상')}) · B 근거 ${pair.coverage_b?.total || 0}건(시장 ${pair.coverage_b?.market || 0} · 기술 ${pair.coverage_b?.tech || 0}, ${escapeHtml(pair.coverage_b?.earliest || '미상')}~${escapeHtml(pair.coverage_b?.latest || '미상')})<br>${escapeHtml(pair.note_ko || '')}</p>` : '';
  const decisionRows = [pairLite.counter_hypothesis_ko, pairLite.data_gaps_ko]
    .filter(Boolean).map(text => `<div class="contrast"><span class="tag">관측 신호</span>${bulletText(text)}</div>`).join('');
  const body = `<header><p class="eyebrow">CHINA BATTERY LENS · 기업 비교 리포트</p>
<h1>${A} vs ${B}</h1>
<p class="meta">근거 이벤트 ${payload.events_a}건 / ${payload.events_b}건 · 근거 범위: ${payload.include_supporting ? '공시·핵심 + 보조(참고) 데이터' : '공시·핵심 데이터만'} · 생성 ${escapeHtml(stamp)} · ${escapeHtml(payload.model || '')}</p></header>
${pairNote}
${r.headline_ko ? `<p class="headline">${escapeHtml(r.headline_ko)}</p>` : ''}
<h2>1. 핵심 비교 논점</h2>${cmpRow('논점 1', 'market_ko')}${cmpRow('논점 2', 'technology_ko')}${cmpRow('논점 3', 'divergence_ko')}
<h2 class="insight">2. 한국 산업에 주는 의미 — 해석</h2>
${points || '<p class="none">해석을 생성하지 못했습니다.</p>'}
${decisionRows ? `<h2>3. 판단이 달라지는 지점</h2>${decisionRows}` : ''}
${r.policy_analysis_ko ? `<h2>중국 정책 변수 — 해석</h2><p class="txt">${bulletText(r.policy_analysis_ko)}</p>` : ''}
${policyLinksHtml(r, payload)}
${r.policy_context?.length ? `<details><summary>정책 연혁 전체 ${r.policy_context.length}건${r.policy_selected_count ? ` · 리포트에는 대표 ${r.policy_selected_count}건 입력` : ''}</summary><ul>${r.policy_context.map(policy => `<li>${escapeHtml(policy.occurred_at)} · ${escapeHtml(policy.title_ko)} — ${escapeHtml(policy.fact_ko)} <small>${escapeHtml(policy.source_name)}</small></li>`).join('')}</ul></details>` : ''}
<h2 class="check">근거 검증${verifyFailed ? ' — 미실시' : ''}</h2>
<p class="txt">${escapeHtml(check.checked_ko || (verifyFailed ? '웹 검증 단계가 실패해 초안 그대로입니다.' : '검증 정보 없음'))}</p>
${verifyFailed ? '' : (fixes ? `<p class="who" style="margin-top:4px">수정</p><ul>${fixes}</ul>` : '<p class="none">초안에서 고칠 사실관계를 찾지 못했습니다.</p>')}
${verifyFailed || !added ? '' : `<p class="who" style="margin-top:4px">검색으로 새로 확인한 사실</p><ul>${added}</ul>`}
<footer>비교 논점은 수집된 사실과 정량 근거에 기반하며, 한국 산업에 주는 의미는 해석입니다. 투자 판단 자료가 아닙니다. ${escapeHtml(dbLine)}</footer>`;
  return { title: `${A} vs ${B} 비교 리포트`, styles, body };
}
// 인쇄용 전체 문서. "PDF로 저장" 버튼이 새 창에 이 문서를 쓰고 인쇄 대화상자를 연다.
function compareReportHtml(payload){
  const { title, styles, body } = compareReportParts(payload);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body>${body}</body></html>`;
}
// 인쇄용 CSS를 화면 안의 리포트 상자에만 적용되게 선택자 앞에 범위를 붙인다. @page·@media는 뺀다.
function scopeReportCss(css, scope){
  return css.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('@')) return '';
    return trimmed.split('}').filter(Boolean).map(rule => {
      const brace = rule.indexOf('{');
      if (brace < 0) return '';
      const selectors = rule.slice(0, brace).split(',').map(sel => sel.trim() === 'body' ? scope : `${scope} ${sel.trim()}`);
      return `${selectors.join(',')}${rule.slice(brace)}}`;
    }).join('');
  }).join('\n');
}
// 지금 패널에 떠 있는 리포트의 인쇄용 문서. 비교 리포트와 함의 종합이 같은 패널·같은 인쇄 버튼을 쓴다.
let lastReportHtml = '';
// 리포트는 비교 화면 아래 접이식 상자에 그린다. 새 창을 바로 띄우면 화면을 떠나게 되고 팝업 차단에도 걸린다.
function mountReportPanel({ title, styles, body }, { unsaved = '', printHtml }){
  lastReportHtml = printHtml;
  const panel = document.querySelector('#compare-report-panel');
  panel.hidden = false;
  panel.innerHTML = `<details class="report-panel" open><summary><span class="report-title">${title}</span><span class="report-actions"><button type="button" class="secondary-button" id="report-save-pdf">PDF로 저장</button><button type="button" class="secondary-button" id="report-close">닫기</button></span></summary><style>${scopeReportCss(styles, '.report-doc')}</style>${unsaved}<div class="report-doc">${body}</div></details>`;
  panel.querySelector('#report-close').addEventListener('click', event => { event.preventDefault(); panel.hidden = true; });
  panel.querySelector('#report-save-pdf').addEventListener('click', event => {
    event.preventDefault();
    const printWindow = window.open('', '_blank');
    if (!printWindow) { window.alert('팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.'); return; }
    printWindow.document.open();
    printWindow.document.write(lastReportHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 400);
  });
  // summary 안의 버튼 클릭이 접기/펼치기로 번지지 않게 한다.
  panel.querySelector('.report-actions').addEventListener('click', event => event.stopPropagation());
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// 방금 만든 리포트인데 history_id가 없으면 히스토리에 남지 않았다는 뜻이다. 화면을 닫으면 사라진다.
function unsavedNote(payload, justMade){
  return payload.history_error || (payload.history_id === null && justMade)
    ? `<p class="load-failure">이 리포트는 히스토리에 저장되지 않았습니다${payload.history_error ? ` (${escapeHtml(payload.history_error)})` : ''}. 창을 닫으면 다시 열 수 없으니 필요하면 PDF로 저장해 주세요.</p>`
    : '';
}
function renderCompareReportPanel(payload){
  mountReportPanel(compareReportParts(payload), { unsaved: unsavedNote(payload, Boolean(payload.db_updates)), printHtml: compareReportHtml(payload) });
}

// ── 리포트 함의 종합 ──────────────────────────────────────────────────
// 지난 비교 리포트 여러 건에서 뽑은 공통 흐름·갈리는 지점·한국 기업 관점. 전부 해석이므로 문서 전체를
// 해석 영역으로 표시하고, 항목마다 재료가 된 리포트 번호를 붙여 근거를 되짚을 수 있게 한다.
function synthesisReportParts(payload){
  const s = payload.synthesis || {};
  const sources = payload.sources || [];
  const stamp = payload.generated_at ? new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(payload.generated_at)) : '';
  // 인쇄용 CSS는 비교 리포트와 같은 것을 쓴다. 활자·여백·색이 한 벌로 보이게 하기 위해서다.
  const { styles } = compareReportParts({ report: {}, company_a: '', company_b: '' });
  const refs = list => (list || []).map(n => `<span class="seg">R${n}</span>`).join('');
  const item = entry => `<div class="point"><p class="lead">${refs(entry.report_refs)}${escapeHtml(entry.theme_ko || '')}</p><p class="txt">${escapeHtml(entry.finding_ko || '')}</p><p class="basis">근거 · ${escapeHtml(entry.basis_ko || '')}</p></div>`;
  const threads = (s.threads || []).map(item).join('');
  const contrasts = (s.contrasts || []).map(item).join('');
  const implications = (s.korea_implications || []).map(entry => `<div class="point"><p class="lead"><span class="seg">${escapeHtml(entry.segment || '')}</span>${refs(entry.report_refs)}${escapeHtml(entry.implication_ko || '')}</p><p class="txt">${escapeHtml(entry.point_ko || '')}</p><p class="basis">근거 · ${escapeHtml(entry.basis_ko || '')}</p></div>`).join('');
  const sourceList = sources.map((src, index) => `<li><span class="tag">R${index + 1}</span>${escapeHtml(src.label)} · ${escapeHtml(compareHistoryDateLabel(src.created_at))} <span class="basis" style="display:inline">[${src.include_supporting ? '보조 포함' : '공시만'}]</span></li>`).join('');
  const title = `${escapeHtml(s.title_ko || '리포트 함의 종합')}`;
  const body = `<header><p class="eyebrow">CHINA BATTERY LENS · 비교 리포트 함의 종합 — 해석</p>
<h1>${title}</h1>
<p class="meta">재료 리포트 ${sources.length}건 · 생성 ${escapeHtml(stamp)} · ${escapeHtml(payload.model || '')} · 웹 검색 없이 저장된 리포트만 근거</p></header>
${s.headline_ko ? `<p class="headline">${escapeHtml(s.headline_ko)}</p>` : ''}
<h2>재료가 된 리포트</h2><ul>${sourceList || '<li class="none">없음</li>'}</ul>
<h2 class="insight">1. 리포트를 가로지르는 공통 흐름</h2>${threads || '<p class="none">두 건 이상에서 되풀이되는 흐름을 찾지 못했습니다.</p>'}
${contrasts ? `<h2 class="insight">2. 갈리는 지점</h2>${contrasts}` : ''}
<h2 class="insight">${contrasts ? '3' : '2'}. 한국 배터리사·소재사 관점</h2>${implications || '<p class="none">해석을 생성하지 못했습니다.</p>'}
${s.limits_ko ? `<h2 class="check">이 종합의 한계</h2><p class="txt">${escapeHtml(s.limits_ko)}</p>` : ''}
<footer>이 문서 전체는 저장된 비교 리포트를 재료로 한 해석입니다. 사실은 각 리포트의 1~2장을 보세요. 투자 판단 자료가 아닙니다.</footer>`;
  return { title: `${s.title_ko || '리포트 함의 종합'} — 함의 종합`, styles, body };
}
function synthesisReportHtml(payload){
  const { title, styles, body } = synthesisReportParts(payload);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body>${body}</body></html>`;
}
function renderSynthesisPanel(payload, justMade = false){
  mountReportPanel(synthesisReportParts(payload), { unsaved: unsavedNote(payload, justMade), printHtml: synthesisReportHtml(payload) });
}

function compareHistoryDateLabel(iso){
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
async function openCompareHistoryItem(id){
  try {
    const response = await fetch(`/api/company?compare_history_id=${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    if (payload.kind === 'synthesis') renderSynthesisPanel(payload);
    else renderCompareReportPanel(payload);
  } catch (error) {
    window.alert(`지난 리포트를 불러오지 못했습니다: ${error.message}`);
  }
}
// 새로 만들거나 비교 화면에 들어올 때마다 지난 리포트 목록을 다시 읽는다. 본문은 클릭해야 불러온다.
// 실패를 빈 화면으로 두면 "리포트가 없다"와 구분되지 않으므로 이유를 적어 남긴다.
function showCompareHistoryFailure(container, reason){
  container.innerHTML = `<p class="load-failure">지난 비교 리포트 목록을 불러오지 못했습니다. ${escapeHtml(reason)} — 저장된 리포트가 없다는 뜻은 아닙니다. 새로고침 후에도 계속되면 접근 세션을 확인해 주세요.</p>`;
}
// 목록은 30건씩 읽고 "더보기"로 이어 붙인다. 함의 종합에 넣을 리포트 선택은 페이지를 넘겨도 유지된다.
const SYNTHESIS_MAX_PICKS = 6;
const compareHistory = { items: [], nextOffset: 0, hasMore: false, picked: new Set() };
function historyItemLabel(item){
  if (item.kind === 'synthesis') return `<span class="hist-kind">함의 종합</span>${escapeHtml(item.title_ko || '리포트 함의 종합')}${item.source_history_ids?.length ? ` <span class="hist-scope">[리포트 ${item.source_history_ids.length}건]</span>` : ''}`;
  return `${escapeHtml(item.company_a_name_ko || '')} vs ${escapeHtml(item.company_b_name_ko || '')} <span class="hist-scope">[${item.include_supporting ? '보조 포함' : '공시만'}]</span>${item.headline_ko ? ` — ${escapeHtml(item.headline_ko)}` : ''}`;
}
function renderCompareHistoryList(){
  const container = document.querySelector('#compare-report-history');
  if (!container) return;
  if (!compareHistory.items.length) {
    container.innerHTML = '<p class="compare-history-empty">아직 저장된 비교 리포트가 없습니다. "비교 리포트 생성"을 누르면 여기에 히스토리로 쌓입니다.</p>';
    return;
  }
  // 선택 순서가 [R1], [R2]… 번호가 된다. 배지로 번호를 보여 준다.
  const pickedOrder = [...compareHistory.picked];
  const rows = compareHistory.items.map(item => {
    const pickable = item.kind !== 'synthesis';
    const order = pickedOrder.indexOf(item.id);
    const box = pickable
      ? `<input type="checkbox" data-pick-id="${item.id}" aria-label="함의 종합에 포함" ${order >= 0 ? 'checked' : ''} ${order < 0 && compareHistory.picked.size >= SYNTHESIS_MAX_PICKS ? 'disabled' : ''}>`
      : '<span style="width:13px;flex:0 0 auto"></span>';
    return `<li>${box}<button type="button" class="link-button" data-history-id="${item.id}">${order >= 0 ? `<span class="hist-ref">R${order + 1}</span>` : ''}${compareHistoryDateLabel(item.created_at)} · ${historyItemLabel(item)}</button></li>`;
  }).join('');
  const count = compareHistory.picked.size;
  container.innerHTML = `<details class="compare-history-list" open><summary>지난 리포트 (${compareHistory.items.length}건${compareHistory.hasMore ? '+' : ''})</summary>
<div class="compare-history-toolbar"><button type="button" class="secondary-button" id="synthesize-reports" ${count < 2 ? 'disabled' : ''}>선택한 리포트 함의 찾기 (${count})</button><span class="compare-history-note">비교 리포트를 2~${SYNTHESIS_MAX_PICKS}건 고르면 공통 흐름·갈리는 지점·한국 기업 관점을 종합합니다. 결과는 해석이며 이 목록에 함께 저장됩니다.</span></div>
<ul>${rows}</ul>${compareHistory.hasMore ? '<button type="button" class="secondary-button hist-more" id="history-more">더보기</button>' : ''}</details>`;
  container.querySelectorAll('[data-history-id]').forEach(button => button.addEventListener('click', () => openCompareHistoryItem(button.dataset.historyId)));
  container.querySelectorAll('[data-pick-id]').forEach(box => box.addEventListener('change', () => {
    if (box.checked) compareHistory.picked.add(box.dataset.pickId); else compareHistory.picked.delete(box.dataset.pickId);
    renderCompareHistoryList();
  }));
  container.querySelector('#synthesize-reports')?.addEventListener('click', synthesizeReports);
  container.querySelector('#history-more')?.addEventListener('click', () => loadCompareReportHistory({ append: true }));
}
async function loadCompareReportHistory({ append = false } = {}){
  const container = document.querySelector('#compare-report-history');
  if (!container) return;
  const offset = append ? compareHistory.nextOffset : 0;
  try {
    const response = await fetch(`/api/company?compare_history=1&offset=${offset}`);
    const payload = await response.json();
    if (payload.status !== 'ok') { showCompareHistoryFailure(container, payload.message || payload.status || `HTTP ${response.status}`); return; }
    const known = new Set(append ? compareHistory.items.map(item => item.id) : []);
    const fresh = payload.history.filter(item => !known.has(item.id));
    compareHistory.items = append ? [...compareHistory.items, ...fresh] : payload.history;
    compareHistory.nextOffset = Number(payload.next_offset) || (offset + payload.history.length);
    compareHistory.hasMore = Boolean(payload.has_more);
    // 목록에서 사라진(삭제된) 리포트는 선택에서도 뺀다. 새로 고침 뒤 선택이 유령으로 남지 않게.
    if (!append) { const ids = new Set(compareHistory.items.map(item => item.id)); for (const id of [...compareHistory.picked]) if (!ids.has(id)) compareHistory.picked.delete(id); }
    renderCompareHistoryList();
  } catch (error) {
    // 파싱 실패 원문("Unexpected token '<'…")은 화면에 쓸모가 없다. 상세는 콘솔로 넘긴다.
    console.error('비교 리포트 히스토리를 불러오지 못했습니다', error);
    showCompareHistoryFailure(container, '서버 응답을 읽지 못했습니다.');
  }
}
async function synthesizeReports(){
  const ids = [...compareHistory.picked];
  if (ids.length < 2) { window.alert('비교 리포트를 2건 이상 골라 주세요.'); return; }
  const button = document.querySelector('#synthesize-reports');
  if (button) button.disabled = true;
  showBusy('리포트 함의 종합 중', `선택한 비교 리포트 ${ids.length}건을 OpenAI가 읽고 공통 흐름·갈리는 지점·한국 기업 관점을 뽑습니다. 웹 검색은 쓰지 않습니다. 1분 안팎 걸립니다.`);
  try {
    const response = await fetch('/api/company', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'synthesize_reports', historyIds: ids })
    });
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    renderSynthesisPanel(payload, true);
    compareHistory.picked.clear();
    await loadCompareReportHistory();
  } catch (error) {
    window.alert(`함의 종합을 만들지 못했습니다: ${error.message}`);
    renderCompareHistoryList();
  } finally {
    hideBusy();
  }
}
// 레이어·기간이 빠지면 서버의 대표 근거 선택이 연도별 한 건으로 줄어든다. 시계열 리포트와 같은 필드를 보낸다.
// 화면에서 제목만 보이는 보조 데이터도 툴팁 내용(사실 전문·발생 법인·출처)은 그대로 리포트에 간다.
const compareReportEvent = event => ({ id: event.id, date: event.date, period: periodOf(event.date), track: event.track, layer: event.layer, title: event.title, fact: event.fact, entity: entityLabel(event), sourceName: event.sourceName, sourceDate: event.sourceDate });
async function generateCompareReport(){
  const options = await chooseReportOptions({ title: '비교 리포트', description: '리포트에 포함할 근거 범위를 선택한 뒤 생성을 시작하세요.' });
  if (!options) return;
  const includePolicyInReport = options.includePolicy;
  if (includeSupporting !== options.includeSupporting) {
    includeSupporting = options.includeSupporting;
    [document.querySelector('#include-supporting'), document.querySelector('#include-supporting-compare')].filter(Boolean).forEach(box => { box.checked = includeSupporting; });
    await refreshSupportingViews(document.querySelector('#include-supporting-compare'));
  }
  if (!lastComparison || (!lastComparison.eventsA.length && !lastComparison.eventsB.length)) {
    window.alert('비교할 이벤트가 화면에 없습니다. 두 기업을 고른 뒤 다시 시도해 주세요.');
    return;
  }
  const button = document.querySelector('#compare-report');
  button.disabled = true;
  showBusy('비교 리포트 생성 중', 'LLM이 두 기업을 비교하고, 웹 검색으로 사실관계를 한 번 대조합니다. 1분 정도 걸립니다.');
  try {
    const response = await fetch('/api/company', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'compare_report',
        includeSupporting,
        includePolicy: includePolicyInReport,
        companyA: lastComparison.a, companyB: lastComparison.b,
        eventsA: lastComparison.eventsA.map(compareReportEvent),
        eventsB: lastComparison.eventsB.map(compareReportEvent)
      })
    });
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    renderCompareReportPanel(payload);
    await loadCompareReportHistory();
  } catch (error) {
    window.alert(`비교 리포트를 만들지 못했습니다: ${error.message}`);
  } finally {
    hideBusy();
    button.disabled = false;
  }
}


// 표시 라벨(2025년, 2025년 하반기 등)만으로는 시간 순서를 정할 수 없으므로 원래 날짜로 정렬한다.
function sortKeyOf(eventsA, eventsB, label){
  const match = [...eventsA, ...eventsB].find(event => displayDate(event) === label);
  return match ? match.date : label;
}

async function renderComparison(){
  const target = document.querySelector('#comparison-grid');
  const selectA = document.querySelector('#compare-a');
  const selectB = document.querySelector('#compare-b');
  const a = selectA.value, b = selectB.value;
  if (!a || !b) { target.innerHTML = '<p>비교할 기업 목록을 불러오지 못했습니다.</p>'; return; }
  target.innerHTML = '<p>이벤트를 불러오는 중…</p>';
  const [timelineA, timelineB] = await Promise.all([loadCompanyTimeline(a), loadCompanyTimeline(b)]);
  if (selectA.value !== a || selectB.value !== b) return;
  const eventsA = visibleEvents(timelineA), eventsB = visibleEvents(timelineB);
  // 리포트는 화면에 그려진 것과 같은 근거를 써야 한다. 여기서 확정된 목록을 그대로 보관한다.
  lastComparison = { a, b, eventsA, eventsB };
  // 축은 정밀도 표기로 묶는다. 연간 집계 여러 건이 12월 31일 한 칸에 쌓이면 그 해의 일로 읽히지 않는다.
  const policies = includePolicy ? (timelineA.policies || timelineB.policies || []) : [];
  const dates = [...new Set([...eventsA, ...eventsB, ...policies].map(event => displayDate(event)))]
    .sort((x, y) => sortKeyOf([...eventsA, ...policies], eventsB, y).localeCompare(sortKeyOf([...eventsA, ...policies], eventsB, x)));
  if (!dates.length) {
    target.innerHTML = `<p>${escapeHtml(timelineNotice(timelineA.status) || timelineNotice(timelineB.status) || '두 기업 모두 확인된 이벤트가 없습니다.')}</p>`;
    return;
  }
  // 비교 화면의 셀은 훑어보는 자리다. 사실 문장을 다 싣지 않고 제목과 핵심 수치만 개조식으로,
  // 중요한 것부터 최대 세 줄 보여준다. 전문은 마우스를 올리면 뜬다.
  const CELL_LIMIT = 3;
  // 한 회사를 기술/시장 두 갈래로 나눠 표시한다. 이벤트는 layer_key 분류에 따라 한 열에만 놓는다.
  // 시장·기술 양쪽 성격을 가진 이벤트는 중복해 싣지 않고, 대표 열에 두되 작은 표식을 붙인다.
  const eventsAt = (events, date, track, companyId) => {
    const ranked = events.filter(event => displayDate(event) === date && event.track === track).sort((x, y) => importanceOf(y) - importanceOf(x));
    const shown = ranked.slice(0, CELL_LIMIT);
    const rest = ranked.length - shown.length;
    return shown.map(event => {
      // 보조 데이터는 제목만 보이고 수치·전문은 툴팁에 있다. 레이어 시간축과 같은 규칙이다.
      const metrics = isPrimaryEvidence(event) ? keyMetrics(event) : '';
      const both = event.both ? '<span class="cmp-both">시장·기술</span>' : '';
      // 공시·검증 통과 사실과 보조(참고) 데이터를 글자색으로 구분한다. 레이어 시간축과 같은 규칙이다.
      const supporting = isPrimaryEvidence(event) ? '' : ' is-supporting';
      return `<div class="cmp-item${supporting}" data-tip="${escapeHtml(eventTip(event))}">${both}<span class="cmp-title">${escapeHtml(stripCompanySubject(event.title, companyId))}</span>${metrics ? `<span class="cmp-metric">${escapeHtml(metrics)}</span>` : ''}${event.sourceUrl ? ` <a class="matrix-src" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ''}</div>`;
    }).join('') + (rest > 0 ? `<div class="cmp-more">+${rest}건 (Excel 내보내기에서 전체 확인)</div>` : '');
  };
  // 배경·테두리는 CSS가 축(track)과 내용 유무(has-items)로 정한다. 여기서는 정렬만 정한다.
  const eventCell = (events, date, track, side, companyId) => { const html = eventsAt(events, date, track, companyId); return `<div class="cmp-cell ${track}${html ? ' has-items' : ''}" style="text-align:${side}">${html || `<span class="cmp-empty" title="${EMPTY_CELL_NOTE}">—</span>`}</div>`; };
  // 두 회사의 근거 두께가 다르면 얇은 쪽이 조용해 보일 뿐 실제로 조용한 게 아니다. 머리에 적어 둔다.
  const coverageOf = events => {
    const reports = new Set(events.filter(e => e.kind === 'annual_report' || e.kind === 'periodic_report' || e.kind === 'disclosure').map(e => e.sourceUrl || e.sourceName));
    const first = events.map(e => e.date).filter(Boolean).sort()[0];
    return `공시 ${reports.size}건 · 이벤트 ${events.length}건${first ? ` · ${first.slice(0, 4)}년~` : ''}`;
  };
  const covA = coverageOf(eventsA), covB = coverageOf(eventsB);
  const ratio = Math.max(eventsA.length, eventsB.length) / Math.max(1, Math.min(eventsA.length, eventsB.length));
  const asym = ratio >= 2 ? `<p class="coverage-warn">근거 두께가 ${ratio.toFixed(1)}배 차이 납니다. 빈칸은 "확인된 사실 없음"이지 "일이 없었다"가 아닙니다.</p>` : '';
  // 5열: 기업A 기술 | 기업A 시장 | 공통 시간축 | 기업B 시장 | 기업B 기술. 시장 열을 시간축 양옆에 붙여 대비시킨다.
  const COLS = 'grid-template-columns:1fr 1fr 118px 1fr 1fr;gap:12px';
  target.innerHTML = `<section class="compare-card" style="padding:22px;overflow-x:auto"><div style="min-width:1120px">${asym}<div style="display:grid;${COLS};align-items:end;margin-bottom:4px"><div class="cmp-head-a" style="grid-column:1/3"><p class="eyebrow">기업 A</p><h2>${escapeHtml(displayName(a))}</h2><p class="coverage-note">${escapeHtml(covA)}</p></div><div style="text-align:center;color:#617187;font-size:12px">공통<br>시간축</div><div class="cmp-head-b" style="grid-column:4/6;text-align:right"><p class="eyebrow">기업 B</p><h2>${escapeHtml(displayName(b))}</h2><p class="coverage-note">${escapeHtml(covB)}</p></div></div><div style="display:grid;${COLS};margin-bottom:10px"><div class="cmp-tracklabel tech" style="text-align:right">기술</div><div class="cmp-tracklabel market" style="text-align:right">시장</div><div></div><div class="cmp-tracklabel market">시장</div><div class="cmp-tracklabel tech">기술</div></div><div style="position:relative">${dates.map((date, index) => { const policy = policyInlineItems(policies.filter(item => displayDate(item) === date)); return `<div style="display:grid;${COLS};align-items:center;min-height:104px"><div>${eventCell(eventsA, date, 'tech', 'right', a)}</div><div>${eventCell(eventsA, date, 'market', 'right', a)}</div><div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">${index < dates.length - 1 ? '<span style="position:absolute;top:50%;bottom:-52px;border-left:2px solid #b8c9d9"></span>' : ''}<span style="position:relative;width:14px;height:14px;border-radius:50%;background:#10365f;border:3px solid #eaf3fb"></span><time style="position:relative;margin-top:5px;color:#617187;font-size:12px;font-weight:700">${date}</time></div><div>${eventCell(eventsB, date, 'market', 'left', b)}</div><div>${eventCell(eventsB, date, 'tech', 'left', b)}</div></div>${policy ? `<div class="comparison-policy-row">${policy}</div>` : ''}`; }).join('')}</div><p style="margin:8px 0 0;text-align:center;color:#617187;font-size:12px">과거 ↓</p></div></section>`;
}
function activateView(view){
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('is-visible', el.id === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('is-active',el.dataset.view===view));
  window.requestAnimationFrame(() => refreshPageOutline(view));
  // 히스토리는 다른 기기·다른 탭에서도 쌓이므로 비교 화면에 들어올 때마다 다시 읽는다.
  if (view === 'compare') loadCompareReportHistory();
}
function viewFromLocationHash(hash = window.location.hash){
  const view = String(hash || '').replace(/^#/, '');
  return ['daily', 'companies', 'compare'].includes(view) ? view : 'daily';
}
let pageOutlineObserver = null;
function setActiveOutlineItem(target){
  document.querySelectorAll('#page-outline-links button').forEach(button => {
    const active = button.dataset.outlineTarget === target;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
}
function refreshPageOutline(view){
  const outline = document.querySelector('#page-outline');
  const links = document.querySelector('#page-outline-links');
  const page = document.querySelector(`#${view}.view`);
  if (!outline || !links || !page) return;
  const compactOutline = window.matchMedia('(max-width: 1600px)').matches;
  if (!compactOutline) outline.classList.remove('is-open');
  document.querySelector('#page-outline-toggle')?.setAttribute('aria-expanded', String(!compactOutline));
  pageOutlineObserver?.disconnect();
  const targets = [page, ...page.querySelectorAll('[data-outline-label]')]
    .filter(target => !target.hidden);
  links.innerHTML = targets.map((target, index) => {
    const id = target.id || `outline-${view}-${index}`;
    target.id = id;
    const label = index === 0
      ? (target.querySelector('h1')?.textContent?.trim() || '페이지 맨 위')
      : target.dataset.outlineLabel;
    return `<button type="button" data-outline-target="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  }).join('');
  links.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    document.getElementById(button.dataset.outlineTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveOutlineItem(button.dataset.outlineTarget);
    if (window.matchMedia('(max-width: 1600px)').matches) {
      outline.classList.remove('is-open');
      document.querySelector('#page-outline-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }));
  setActiveOutlineItem(targets[0]?.id || '');
  pageOutlineObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActiveOutlineItem(visible[0].target.id);
  }, { rootMargin: '-82px 0px -62% 0px', threshold: 0 });
  targets.forEach(target => pageOutlineObserver.observe(target));
}
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => activateView(link.dataset.view)));
// /admin의 메뉴는 /#companies처럼 페이지를 새로 연다. 클릭 핸들러는 그 요청에 관여하지 않으므로,
// 첫 로드·뒤로가기·직접 URL 모두 해시를 읽어 같은 화면을 연다.
window.addEventListener('hashchange', () => activateView(viewFromLocationHash()));
document.querySelector('#page-outline-toggle')?.addEventListener('click', event => {
  if (!window.matchMedia('(max-width: 1600px)').matches) return;
  const outline = document.querySelector('#page-outline');
  const open = outline.classList.toggle('is-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});


document.querySelector('#refresh-button').addEventListener('click', async () => { companyTimelineCache.clear(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews(); renderCompanyPicker(); await loadDashboardFromApi(); await renderCompany(); await renderComparison(); });
document.querySelector('#sankey-range-apply').addEventListener('click', loadDashboardFromApi);
// 이미 받은 흐름에서 등급만 걸러 그리므로 서버를 다시 부르지 않는다.
document.querySelector('#sankey-include-headlines')?.addEventListener('change', renderHeadlineSankey);
// 수집은 시작만 이 요청으로 하고, 본문 처리와 Daily 생성은 서버가 별도 호출로 이어 간다.
// 그래서 여기서는 새 Daily가 생길 때까지 첫 화면을 주기적으로 다시 읽으며 기다린다.
async function waitForDailyReport(sinceIso, timeoutMs = 4 * 60 * 1000){
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    const elapsed = Math.round((Date.now() - started) / 1000);
    updateBusy(`본문 정독과 팩트 확인, Daily 생성이 서버에서 이어지고 있습니다. ${elapsed}초 경과`);
    try {
      const result = await fetch(`/api/dashboard?_=${Date.now()}`, { cache: 'no-store' });
      const payload = await result.json();
      const generatedAt = payload?.report?.generated_at;
      if (generatedAt && generatedAt > sinceIso) return true;
    } catch { /* 일시적 오류는 다음 주기에 다시 본다 */ }
  }
  return false;
}
document.querySelector('#run-collection-button').addEventListener('click', async () => {
  if (!(await confirmAccessCode('수집·분석 1회 실행'))) return;
  const button = document.querySelector('#run-collection-button');
  button.disabled = true; button.textContent = '수집·분석 중…';
  showBusy('수집·분석 중', '중국어 원문을 검색해 기사를 모으고 있습니다.');
  const startedAt = new Date().toISOString();
  try {
    const result = await fetch('/api/ingest-rss?process=1', { method: 'POST' });
    const payload = await result.json();
    if (!result.ok) throw new Error([payload.status, payload.stage, payload.message].filter(Boolean).join(' · ') || '요청 실패');
    const done = payload.status === 'started' ? await waitForDailyReport(startedAt) : true;
    window.alert(`수집 완료: 발견 ${payload.discovered}건 / 저장 ${payload.stored}건\n${done ? '본문 처리와 Daily 생성까지 반영됐습니다.' : '본문 처리가 아직 진행 중입니다. 잠시 뒤 새로 고침하면 반영됩니다.'}`);
    companyTimelineCache.clear();
    await loadDashboardFromApi();
    await renderCompany();
    await renderComparison();
  } catch (error) {
    window.alert(`수집을 실행하지 못했습니다: ${error.message}`);
  } finally {
    hideBusy();
    button.disabled = false; button.textContent = '수집·분석';
  }
});
// 백필류 버튼은 오조작을 막기 위해 입장 코드를 한 번 더 확인한다. /api/access가 이미 검증 로직을 갖고 있으므로 재사용한다.
async function confirmAccessCode(actionLabel){
  const code = window.prompt(`"${actionLabel}"을(를) 실행하려면 입장 코드를 입력하세요.`);
  if (!code) return false;
  try {
    const result = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: code })
    });
    if (result.ok) return true;
    window.alert('입장 코드가 일치하지 않습니다.');
    return false;
  } catch (error) {
    window.alert(`코드 확인에 실패했습니다: ${error.message}`);
    return false;
  }
}
// 시계열 백필 1회 실행. Vercel은 같은 함수의 재귀 호출을 5번째에 508로 막으므로
// 브라우저가 독립 요청으로 한 홉씩 호출한다. 탭을 닫으면 다음 홉은 시작되지 않는다.
async function runTimelineBackfill(){
  if (!(await confirmAccessCode('정기보고서 재처리'))) return;
  if (!window.confirm('정기보고서만 한 건씩 읽고 시계열 이벤트와 벡터 임베딩을 갱신합니다. 완료될 때까지 이 탭을 열어 두세요. 시작할까요?')) return;
  const button = document.querySelector('#run-backfill-button');
  button.disabled = true; button.textContent = '백필 시작 중…';
  try {
    let completed = 0;
    let lastTask = '';
    for (let hop = 1; hop <= 40; hop += 1) {
      button.textContent = `시계열 백필 진행 중 (${hop}/40)`;
      const result = await fetch(`/api/ingest-rss?curate_step=1&task=renew&hop=${hop}`, { method: 'POST' });
      const payload = await result.json();
      if (!result.ok) throw new Error([payload.status, payload.message].filter(Boolean).join(' · ') || `홉 ${hop} 요청 실패`);
      completed = hop;
      lastTask = payload.task || lastTask;
      if (!payload.more) break;
    }
    companyTimelineCache.clear();
    await renderCompany();
    window.alert(`시계열 백필을 완료했습니다.\n실행 ${completed}단계 · 마지막 작업 ${lastTask || '없음'}`);
    button.disabled = false; button.textContent = '재처리';
  } catch (error) {
    window.alert(`백필 실행 중 실패했습니다: ${error.message}`);
    button.disabled = false; button.textContent = '재처리';
  }
}
// 벡터DB(knowledge_chunk)에 아직 없는 event를 임베딩 API로 채운다. 남은 만큼 반복 호출한다.
async function runEmbedBackfill(){
  if (!(await confirmAccessCode('벡터DB 임베딩 채우기'))) return;
  const button = document.querySelector('#run-embed-button');
  button.disabled = true; button.textContent = '임베딩 중…';
  let totalEmbedded = 0;
  try {
    for (let guard = 0; guard < 30; guard += 1) {
      const result = await fetch('/api/embed-event', { method: 'POST' });
      const payload = await result.json();
      if (!result.ok) throw new Error([payload.status, payload.message].filter(Boolean).join(' · ') || '요청 실패');
      totalEmbedded += payload.embedded || 0;
      button.textContent = `임베딩 중… (${totalEmbedded}건, 남음 ${payload.remaining})`;
      if (!payload.embedded || payload.remaining <= 0) break;
    }
    window.alert(`벡터DB 임베딩을 완료했습니다. 이번 실행에서 ${totalEmbedded}건 색인.`);
  } catch (error) {
    window.alert(`임베딩을 실행하지 못했습니다: ${error.message}`);
  } finally {
    button.disabled = false; button.textContent = '임베딩';
  }
}
// 보고서에서 이미 확정한 상세 사실은 보존하고, 카드·표용 한국어 한 문장만 별도 열에 채운다.
// 서버 함수가 한 번에 16건씩 처리하므로 브라우저가 독립 요청으로 다음 배치를 이어 호출한다.
async function runEventDisplaySummary(){
  if (!(await confirmAccessCode('화면용 보고서 요약 생성'))) return;
  if (!window.confirm('연차·반기·분기보고서 이벤트의 화면용 한국어 요약을 생성합니다. 상세 사실, 원문 발췌, 링크는 바꾸지 않습니다. 뉴스 수집용 OpenAI 모델을 사용합니다. 완료될 때까지 이 탭을 열어 두세요. 시작할까요?')) return;
  const button = document.querySelector('#run-event-summary-button');
  button.disabled = true;
  let total = 0;
  try {
    for (let hop = 1; hop <= 200; hop += 1) {
      button.textContent = `화면 요약 생성 중… (${total}건)`;
      const response = await fetch('/api/company', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'event_display_summary', limit: 16 })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'ok') throw new Error(payload.message || payload.status || `HTTP ${response.status}`);
      total += payload.updated || 0;
      if (!payload.selected || !payload.remaining) break;
    }
    companyTimelineCache.clear();
    await renderCompany();
    window.alert(`화면용 요약 ${total}건을 생성했습니다. 상세 사실과 원문은 그대로 보존되어 있습니다.`);
  } catch (error) {
    window.alert(`화면용 요약 생성 중 실패했습니다: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '요약 생성';
  }
}
async function initialize(){
  // 카탈로그·대시보드 요청이 끝날 때까지 기본 Daily가 보이면 /#companies 직접 링크가 Daily처럼 보인다.
  // 먼저 URL의 화면을 켜고, 그 다음 해당 화면의 데이터를 채운다.
  activateView(viewFromLocationHash());
  await loadCompanyCatalog();
  const compareA = document.querySelector('#compare-a');
  const compareB = document.querySelector('#compare-b');
  // 첫 선택은 밸류체인 맨 앞(SNE 순위 1위)이다. 기업 분석과 비교 A는 셀사 1위, 비교 B는 양극재 1위로
  // 열어 둔다. 셀과 양극재는 서로 다른 층이라 처음 보는 화면이 "무엇과 무엇을 견주는 자리"인지 바로 보인다.
  const firstIn = chain => companiesInValueChain(chain)[0]?.id || '';
  currentCompany = firstIn('cell') || companyCatalog[0]?.id || '';
  const compareBId = firstIn('cathode') || currentCompany;
  currentChain = companyById(currentCompany)?.value_chain || 'cell';
  renderCompanyPicker();
  const chainA = currentChain, chainB = companyById(compareBId)?.value_chain || 'cathode';
  makeSelect(compareA, currentCompany, chainA);
  makeSelect(compareB, compareBId, chainB);
  makeChainTabs(document.querySelector('#compare-chain-a'), chainA, chain => { makeSelect(compareA, '', chain); renderComparison(); });
  makeChainTabs(document.querySelector('#compare-chain-b'), chainB, chain => { makeSelect(compareB, '', chain); renderComparison(); });
  document.querySelector('#compare-report').addEventListener('click', generateCompareReport);
  document.querySelectorAll('[data-timeline-report-mode]').forEach(button => {
    button.addEventListener('click', () => generateTimelineReport(button.dataset.timelineReportMode));
  });
  // 목록은 비교 화면을 열 때 activateView가 읽는다. 첫 화면은 Daily라 여기서 미리 받아둘 이유가 없다.
  compareA.addEventListener('change', renderComparison);
  compareB.addEventListener('change', renderComparison);
  document.querySelector('#export-company-timeline').addEventListener('click', exportCompanyTimeline);
  document.querySelector('#run-backfill-button').addEventListener('click', runTimelineBackfill);
  document.querySelector('#run-embed-button').addEventListener('click', runEmbedBackfill);
  document.querySelector('#run-event-summary-button').addEventListener('click', runEventDisplaySummary);
  document.querySelector('#ask-form').addEventListener('submit', askKnowledge);
  document.querySelector('#news-more').addEventListener('click', () => { topNewsExpanded = !topNewsExpanded; renderTopNews(); });
  // 보조 데이터 토글은 기업 시계열 화면과 비교 화면 두 곳에 있고, 같은 상태를 공유한다.
  const supportingToggles = [document.querySelector('#include-supporting'), document.querySelector('#include-supporting-compare')].filter(Boolean);
  supportingToggles.forEach(box => {
    box.checked = includeSupporting;
    box.addEventListener('change', async () => {
      includeSupporting = box.checked;
      supportingToggles.forEach(other => { other.checked = includeSupporting; });
      await refreshSupportingViews(box);
    });
  });
  const policyToggles = [document.querySelector('#include-policy'), document.querySelector('#include-policy-compare')].filter(Boolean);
  policyToggles.forEach(box => {
    box.checked = includePolicy;
    box.addEventListener('change', async () => {
      includePolicy = box.checked;
      policyToggles.forEach(other => { other.checked = includePolicy; });
      await refreshSupportingViews(box);
    });
  });
  document.querySelector('#export-raw-news').addEventListener('click', exportRawNews);
  // 고른 날짜 리포트를 새 탭으로 연다. 여러 날짜를 나란히 놓고 비교할 수 있다.
  document.querySelector('#report-open-button')?.addEventListener('click', () => {
    const date = document.querySelector('#report-date-picker')?.value;
    if (!date) { window.alert('열 수 있는 리포트 날짜가 없습니다.'); return; }
    window.open(`${window.location.pathname}?report=${encodeURIComponent(date)}`, '_blank', 'noopener');
  });
  // ?report=로 들어온 경우 그날 리포트만 보는 화면으로 전환한다.
  const singleReport = reportDateFromUrl();
  if (singleReport) enterSingleReportView(singleReport);
  // toISOString은 UTC 날짜를 준다. 한국은 UTC+9라 오전에는 하루 뒤처진 날짜가 잡혀
  // 오늘 기사가 기간에서 빠진다. 현지 날짜 구성요소로 직접 만든다.
  const localDate = (offsetDays) => {
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offsetDays*86400000));
  };
  // 헤드라인은 기본적으로 당일부터 이틀 전까지 본다. 월요일에는 직전 금요일을 포함하도록 3일 전부터 본다.
  const headlineFromOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Mon' ? -3 : -2;
  document.querySelector('#sankey-from').value = localDate(headlineFromOffset);
  document.querySelector('#sankey-to').value = localDate(0);
  // 회사별 뉴스 기본은 어제~오늘이다. 수집이 밤 23시에 돌아 오늘 것만 보면 이른 시간에 비어 보인다.
  document.querySelector('#news-from').value = localDate(-3);
  document.querySelector('#news-to').value = localDate(0);
  document.querySelector('#news-range-apply').addEventListener('click', loadDashboardFromApi);
  renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  await loadDashboardFromApi();
  await renderCompany();
  await renderComparison();
}
initialize();
