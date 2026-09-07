const valueChainLabels = { cell: '셀사', cathode: '양극재', anode: '음극재' };
// 헤드라인 흐름도에 한 번에 세울 기업 수. 넘으면 출하 순위 상위만 남기고 나머지는 안내문으로 알린다.
const SANKEY_COMPANY_LIMIT = 12;
// 밸류체인별 표식 색. 파랑·보라·주황 세 계열로 갈라 한눈에 구분되게 한다.
// 흐름도 링크가 초록(확대)·빨강(축소)을 쓰므로 그 두 색은 피한다.
const CHAIN_COLORS = { cell: '#10365f', cathode: '#5b3d94', anode: '#7d5010' };
const CHAIN_BG = { cell: '#cfe0f2', cathode: '#e2d9f3', anode: '#f7e3c4' };
const marketLayerLabels = {
  'supply-performance': '수급·실적',
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
let pendingCandidates = [];
let rangeFlows = [];
let lastComparison = null;
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
  const sections = parseDailySections(dailyReportFacts || []);
  if (!sections.length) {
    target.innerHTML = '<p class="summary-empty">아직 생성된 Daily Report가 없습니다. 수집·분석 1회 실행 후 Top 10 본문 분석 결과와 통합 리포트가 이 영역에 표시됩니다.</p>';
    return;
  }
  target.innerHTML = sections.map(section => {
    const category = section.category === '산업 총평' ? '주요 사실' : section.category;
    const chip = category
      ? `<p class="summary-cat ${summaryCategoryClass[category] || ''}">${escapeHtml(category)}</p>`
      : '';
    return `<div class="summary-block">${chip}<ul>${section.points.map(point => `<li>${formatSummaryPoint(point)}</li>`).join('')}</ul></div>`;
  }).join('');
  renderDailyInsight();
}

// 해석은 사실이 아니다. prd.md의 "사실, 해석, 추정을 구분한다"에 따라 영역을 나누고
// 판단의 근거가 된 사실을 항목마다 함께 보여준다.
function renderDailyInsight(){
  const target = document.querySelector('#daily-insight');
  if (!target) return;
  const sections = parseDailySections(dailyReportInsight || []);
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
    const category = section.category === '오늘의 그림' ? '산업 총평' : section.category;
    return `<div class="summary-block">${category ? `<p class="summary-cat insight">${escapeHtml(category)}</p>` : ''}${blocks}</div>`;
  }).join('');
  target.innerHTML = `<div class="insight-head"><p class="eyebrow">INSIGHT</p><h3>산업 총평과 한국 기업 관점</h3><span class="source-rule">사실이 아니라 해석입니다</span></div>${body}`;
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

function classifyCandidate(article){
  const title = `${article.title_original || ''} ${article.title_ko || ''}`.toLowerCase();
  const event = /扩产|增产|产能|项目|投产|开工|factory|capacity|production/.test(title) ? '투자·생산' :
    /认证|客户|订单|供货|出货|交付|customer|order/.test(title) ? '고객·상업화' :
    /专利|技术|研发|电池|材料|硅|磷酸|钠|technology|patent/.test(title) ? '기술·제품' :
    /业绩|营收|利润|价格|销量|市场|financial|revenue/.test(title) ? '실적·시장' : '일반 산업 뉴스';
  const relation = article.article_company?.[0];
  const type = relation?.company?.type_tags?.[0];
  return { event, type: type === 'anode' ? '음극재' : type === 'cathode' ? '양극재' : type === 'cell' ? '셀사' : '미분류' };
}

function renderCandidateQueue(){
  const target = document.querySelector('#candidate-news-feed');
  const count = document.querySelector('#candidate-news-count');
  if (!target || !count) return;
  count.textContent = pendingCandidates.length ? `최신 ${pendingCandidates.length}건 · Top 10 미선정` : '수집 후보 없음';
  target.innerHTML = '';
  if (!pendingCandidates.length) {
    target.innerHTML = '<p>수집 후보가 없습니다. 수집 1회 실행 후 다시 불러오세요.</p>';
    return;
  }
  const template = document.querySelector('#news-template');
  pendingCandidates.forEach(item => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = `${item.classification.type} · ${item.classification.event}`;
    node.querySelector('.confidence-tag').textContent = '수집 후보';
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.news-fact').textContent = `분류 근거: 회사 별칭 매칭 / 제목 키워드 ‘${item.classification.event}’. 원문 본문과 출처 신뢰도는 아직 검증하지 않았습니다.`;
    node.querySelector('.impact-reason').textContent = `출처: ${item.sourceName || 'RSS'}`;
    node.querySelector('a').href = item.url;
    target.append(node);
  });
}
function renderHeadlineSankey(){
  const counts = new Map();
  // 검증 기사와 미검증 헤드라인을 따로 센다. 툴팁이 둘을 나눠 보여야 얼마나 믿을지 읽는 사람이 정할 수 있다.
  const grades = new Map();
  // 왜 그 방향인지는 서버가 신호마다 판단해 내려준다. 화면은 그 근거를 모아 툴팁으로 보여준다.
  const reasons = new Map();
  const includeHeadlines = document.querySelector('#sankey-include-headlines')?.checked !== false;
  let headlineArticles = 0;
  // 오른쪽 노드 라벨(keyword)은 서버가 테마 10개로 접어 내려준다. 화면에서 다시 다듬지 않는다.
  rangeFlows.forEach(({company_id, keyword, direction, reason, title, grade, matched}) => {
    if (!keyword || !['positive', 'negative'].includes(direction)) return;
    const isHeadline = grade === 'headline';
    if (isHeadline && !includeHeadlines) return;
    if (isHeadline) headlineArticles += 1;
    const key = `${company_id}\u0000${direction}\u0000${keyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const gradeCount = grades.get(key) || { verified: 0, headline: 0 };
    gradeCount[isHeadline ? 'headline' : 'verified'] += 1;
    grades.set(key, gradeCount);
    if (reason || title) {
      // 제목과 근거 문장을 줄을 나눠 담는다. 도착지 라벨만 되풀이하면 툴팁이 쓸모없다.
      // 헤드라인은 근거가 제목뿐이라 그렇게 표시하고, 어떤 표현이 신호로 잡혔는지만 덧붙인다.
      const bucket = reasons.get(key) || [];
      const line = isHeadline
        ? [`· [헤드라인] ${title}`, matched ? `  잡힌 표현: ${matched}` : ''].filter(Boolean).join('\n')
        : [title ? `· ${title}` : '', reason ? `  ${reason}` : ''].filter(Boolean).join('\n');
      if (bucket.length < 3 && !bucket.includes(line)) bucket.push(line);
      reasons.set(key, bucket);
    }
  });
  const flows = [...counts.entries()].map(([key, count]) => {
    const [company, direction, keyword] = key.split('\u0000');
    return { company, direction, keyword, count, grades: grades.get(key) || { verified: count, headline: 0 }, reasons: reasons.get(key) || [] };
  });
  const target = document.querySelector('#headline-sankey');
  if (!flows.length) {
    target.innerHTML = includeHeadlines
      ? '<p>선택 기간에 확대·축소 신호로 분류된 비-Top 10 기사가 없습니다.</p>'
      : '<p>선택 기간에 본문 검증을 통과한 비-Top 10 기사 중 확대·축소 신호가 없습니다. "미검증 헤드라인 포함"을 켜면 표본이 넓어집니다.</p>';
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
  // 그럴 때는 출하 순위(SNE) 상위 기업만 남기고, 몇 개사를 감췄는지 그래프 위에 알린다.
  const allCompanies = [...new Set(matchedFlows.map(flow => flow.company))];
  const rank = id => companyById(id)?.priority ?? 99;
  const flowCount = id => matchedFlows.filter(flow => flow.company === id).reduce((sum, flow) => sum + flow.count, 0);
  const sourceNames = allCompanies.length > SANKEY_COMPANY_LIMIT
    ? [...allCompanies].sort((x, y) => rank(x) - rank(y) || flowCount(y) - flowCount(x)).slice(0, SANKEY_COMPANY_LIMIT)
    : allCompanies;
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
    const breakdown = flow.grades.headline ? ` (검증 ${flow.grades.verified} · 헤드라인 ${flow.grades.headline})` : '';
    const tip = `${displayName(flow.company)} → ${flow.keyword} · ${flow.direction === 'positive' ? '확대' : '축소'} ${flow.count}건${breakdown}${flow.reasons.length ? `\n\n${flow.reasons.join('\n\n')}` : ''}`;
    return `<path d="${curve(268, sy, 600, ky)}" fill="none" stroke="${color}" stroke-width="${Math.min(18, 3 + flow.count * 3)}" stroke-opacity=".58" data-tip="${escapeHtml(tip)}"/>`;
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
  if (hiddenCount) noticeParts.push(`신호가 잡힌 ${allCompanies.length}개사 중 <strong>출하 순위 상위 ${sourceNames.length}개사</strong>만 표시합니다. 나머지 ${hiddenCount}개사는 기간을 좁히면 보입니다.`);
  if (headlineArticles) noticeParts.push(`미검증 헤드라인 신호 <strong>${headlineArticles}건</strong>이 포함돼 있습니다. 제목만으로 분류한 것이라 툴팁에서 검증 건수와 나눠 표시합니다.`);
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
    confidence: article.verification_status === 'pending_review' ? '본문대조 완료' : article.verification_status === 'pending' ? '미분석' : article.source_tier || '검수 완료',
    confidenceTitle: article.verification_status === 'pending_review' ? '원문 본문 대조 팩트체크 완료' : article.verification_status === 'pending' ? '미분석 수집 원문' : article.source_tier || '검수 완료',
    top10Rank: article.is_top10 ? article.top10_rank : null,
    url: article.canonical_url,
    sourceName: article.source_name,
    classification: classifyCandidate(article)
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
  const el = document.querySelector('.as-of');
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
    pendingCandidates = (payload.pendingNews || []).map(mapDashboardArticle);
    rangeFlows = payload.flows || [];
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

// 기업 시계열은 공시 원문에서 나온 사실과 핵심 등급 기사만 기본으로 보여준다.
// 참고 등급 기사와 웹 검색 백필은 '보조 데이터 포함'을 켤 때만 나온다.
const evidenceLabels = { annual_report: '연차보고서', periodic_report: '반기·분기보고서', disclosure: '거래소 공시', article: '언론', web_backfill: '웹 검색' };
function isPrimaryEvidence(event){
  // 거래소 공시는 회사가 직접 낸 1차 출처라 정기보고서와 같은 핵심 등급으로 본다.
  if (event.kind === 'annual_report' || event.kind === 'periodic_report' || event.kind === 'disclosure') return true;
  return event.kind === 'article' && event.eligibility === '핵심';
}
function visibleEvents(timeline){
  return includeSupporting ? timeline.events : timeline.events.filter(isPrimaryEvidence);
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
    region: event.region_scope || '',
    eligibility: event.timeline_eligibility === 'core' ? '핵심' : event.timeline_eligibility === 'reference' ? '참고' : '',
    sourceName: event.source_name || event.article?.source_name || '출처 미상',
    sourceUrl: event.source_url || event.article?.canonical_url || '',
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
    events: (payload?.events || []).map(normalizeEvent).filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date))
  };
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
  if (state) {
    state.textContent = notice || (shown.length
      ? `공시·핵심 근거 이벤트 ${shown.length}건을 표시합니다.${hidden ? ` 보조 데이터 ${hidden}건은 숨겨져 있습니다.` : ''}`
      : '표시할 공시 기반 이벤트가 없습니다. 연차보고서 요약을 실행하면 이 화면에 채워집니다.');
  }
  renderCompanyEvents(timeline);
  renderLayerMatrix(timeline);
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
  return [event.fact, entityLabel(event) ? `발생 법인: ${entityLabel(event)}` : '', `출처: ${event.sourceName}`].filter(Boolean).join('\n\n');
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
function renderCompanyEvents(timeline){
  const grid = document.querySelector('#snapshot-grid');
  grid.className = 'snapshot-grid digest-stack';
  const events = visibleEvents(timeline).filter(event => event.kind === 'annual_report' || event.kind === 'periodic_report');
  if (!events.length) {
    grid.innerHTML = `<p>${escapeHtml(timelineNotice(timeline.status) || '아직 읽어들인 정기보고서가 없습니다. 매일 밤 수집 뒤 자동으로 채워집니다.')}</p>`;
    return;
  }
  // 보고서(시점)마다 카드 하나. 안에서는 시장/기술 두 열로 나누고 중요한 것부터 몇 줄만 보인다.
  const groups = new Map();
  [...events].sort((a, b) => b.date.localeCompare(a.date)).forEach(event => {
    const label = displayDate(event);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(event);
  });
  const line = event => {
    const title = shortTitle(stripCompanySubject(event.title, timeline.companyId));
    const metrics = [...new Set([...String(event.fact || '').matchAll(METRIC_PATTERN)].map(m => m[1].trim()))].filter(m => !title.includes(m)).slice(0, 2).join(' · ');
    return `<li class="digest-line" data-tip="${escapeHtml(eventTip(event))}"><span class="digest-title">${escapeHtml(title)}</span>${metrics ? `<span class="digest-metric">${escapeHtml(metrics)}</span>` : ''}</li>`;
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
    return `<details class="digest-year"${index === 0 ? ' open' : ''}><summary><span class="digest-year-label">${escapeHtml(year)}년</span><span class="digest-year-meta">보고서 ${entries.length}건 · 사실 ${count}건</span></summary><div class="digest-year-body">${entries.map(card).join('')}</div></details>`;
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
  const notice = timelineNotice(timeline.status);
  if (!events.length) {
    target.innerHTML = `<p>${escapeHtml(notice || '선택한 기업에 표시할 공시 기반 이벤트가 아직 없습니다.')}</p>`;
    return;
  }
  const periods = timelinePeriods(events).slice().reverse();
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
      const tip = [event.fact, `레이어: ${event.label}`, entityLabel(event) ? `발생 법인: ${entityLabel(event)}` : '', `출처: ${event.sourceName}`].filter(Boolean).join('\n\n');
      const unclassified = event.layer === UNCLASSIFIED_LAYER ? '<span class="matrix-entity">미분류</span>' : '';
      // 공시·검증 통과 사실과 보조(참고) 데이터를 글자색으로 구분한다.
      const supporting = isPrimaryEvidence(event) ? '' : ' is-supporting';
      return `<div class="matrix-item${supporting}" data-tip="${escapeHtml(tip)}"><span class="matrix-title">${escapeHtml(shortTitle(stripCompanySubject(event.title, timeline.companyId || currentCompany)))}</span>${unclassified}${entityLabel(event) ? `<span class="matrix-entity">${escapeHtml(entityLabel(event))}</span>` : ''}${event.sourceUrl ? ` <a class="matrix-src" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ''}</div>`;
    }).join('');
  };
  const head = MATRIX_GROUPS.map(group => `<th class="matrix-head ${group.track}">${group.label}</th>`);
  const body = periods.map(period => {
    // 셀에도 축 클래스를 달아 시장·기술 절반이 배경색으로 갈리게 한다.
    const cells = MATRIX_GROUPS.map(group => `<td class="matrix-cell ${group.track}">${cell(group, period)}</td>`);
    return `<tr>${cells[0]}${cells[1]}<th class="matrix-period">${period}</th>${cells[2]}${cells[3]}</tr>`;
  }).join('');
  target.innerHTML = `<div class="matrix-scroll" style="overflow-x:auto"><table class="matrix-table"><thead><tr><th class="matrix-track market" colspan="2">시장</th><th></th><th class="matrix-track tech" colspan="2">기술</th></tr><tr>${head[0]}${head[1]}<th class="matrix-period-head">시점</th>${head[2]}${head[3]}</tr></thead><tbody>${body}</tbody></table></div><p style="margin:10px 0 0;color:#617187;font-size:12px">위가 최근, 아래로 갈수록 과거입니다. 지난 연도는 상·하반기, 당해 연도는 분기로 나눕니다. 왼쪽 두 칸이 시장(실적·생산기반 / 고객·해외), 오른쪽 두 칸이 기술(소재·공정 / IP·인증·양산)입니다. 자세한 사실과 원래 레이어는 항목에 마우스를 올리면 보입니다. 빈 칸(—)은 그 구간에 ${EMPTY_CELL_NOTE}을 뜻하며 사건이 없었다는 뜻이 아닙니다.</p>`;
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
  const gradeNote = unverified ? ` (그중 미검증 헤드라인 ${unverified}건)` : '';
  const scopeNote = (scoped ? `${displayName(currentCompany)} 근거 ${payload.matched}건에서 찾았습니다.` : `전체 기업 근거 ${payload.matched}건에서 찾았습니다.`) + gradeNote;
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
      const grade = source.verified === false ? ' <span class="ask-grade">미검증 헤드라인</span>' : '';
      return `<li><span class="n">${source.n}</span>${escapeHtml(head)}${grade}${link}<br>${escapeHtml(source.excerpt)}</li>`;
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
  if (window.XLSX) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{wch:20}, {wch:30}, {wch:14}, {wch:8}, {wch:18}, {wch:10}, {wch:12}, {wch:30}, {wch:70}, {wch:14}, {wch:12}, {wch:20}, {wch:55}, {wch:55}, {wch:55}];
    rows.slice(1).forEach((row, index) => { const cell = sheet[`M${index + 2}`]; if (cell && row[12]) cell.l = { Target: row[12] }; });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기업 시계열');
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
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!cols'] = [36,18,14,60,50,20,20,70,70,35,18,18,10,8];
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
function compareReportParts(payload){
  const r = payload.report || {};
  const insight = r.korea_insight || {};
  const check = r.verification || {};
  const db = payload.db_updates || {};
  const A = escapeHtml(payload.company_a), B = escapeHtml(payload.company_b);
  const traj = r.trajectory || {};
  const cmp = r.comparison || {};
  // 1단계: 각 회사의 시장·기술 궤적을 회사별로 보여준다. 2단계 비교는 그 아래에 축별로 묶는다.
  const trajCard = (who, node) => `
    <div class="col"><p class="who">${who}</p>
    <p class="txt"><span class="axis-tag market">시장</span>${escapeHtml(node?.market_ko || '')}</p>
    <p class="txt"><span class="axis-tag tech">기술</span>${escapeHtml(node?.technology_ko || '')}</p></div>`;
  const cmpRow = (label, key) => cmp?.[key] ? `<p class="contrast"><span class="tag">${label}</span>${escapeHtml(cmp[key])}</p>` : '';
  const points = (insight.points || []).map(item => `
    <div class="point"><p class="lead"><span class="seg">${escapeHtml(item.segment || '')}</span>${escapeHtml(item.implication_ko || '')}</p>
    <p class="txt">${escapeHtml(item.point_ko || '')}</p><p class="basis">근거 · ${escapeHtml(item.basis_ko || '')}</p></div>`).join('');
  const fixes = (check.corrections || []).map(item => {
    // DB에 실제로 되돌리는 것은 날짜(시점) 교정뿐이다. 그 밖의 교정은 리포트 본문만 고친 것이라 라벨을 구분한다.
    const dbNote = item.field === 'occurred_at' && item.event_id ? ' · DB 이벤트 시점 수정 반영' : ' · 리포트 본문만 수정(DB 미반영)';
    return `<li><span class="was">${escapeHtml(item.original_ko || '')}</span><span class="now">${escapeHtml(item.corrected_ko || '')}</span><span class="basis">${escapeHtml(item.reason_ko || '')}${dbNote}</span></li>`;
  }).join('');
  const added = (check.added_evidence || []).map(item => `
    <li><strong>${escapeHtml(item.company === 'B' ? payload.company_b : payload.company_a)}</strong> · ${escapeHtml(item.occurred_at || '')} · ${escapeHtml(item.fact_ko || '')}<span class="basis">${escapeHtml(item.source_name || '')} · <a href="${escapeHtml(item.source_url || '')}">${escapeHtml(item.source_url || '')}</a></span></li>`).join('');
  const stamp = new Date(payload.generated_at || Date.now()).toLocaleString('ko-KR');
  const dbLine = payload.verification_status === 'draft_only'
    ? '웹 검증에 실패해 초안 상태입니다.'
    : `DB 반영 · 시점 수정 ${db.dates_fixed || 0}건 · 참고 이벤트 추가 ${db.events_added || 0}건`;
  const styles = `
@page{size:A4;margin:13mm 14mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Malgun Gothic","Noto Sans KR","Segoe UI",sans-serif;font-size:9.6px;line-height:1.6;color:#14263d}
header{border-bottom:2px solid #10365f;padding-bottom:6px;margin-bottom:9px}
.eyebrow{margin:0;font-size:8px;font-weight:800;letter-spacing:1.1px;color:#1674c5}
h1{margin:2px 0 3px;font-size:16px;letter-spacing:-.3px}
.meta{margin:0;font-size:8.2px;color:#617187}
.headline{margin:0 0 8px;padding:7px 10px;border-left:3px solid #10365f;background:#f3f6fa;font-size:10.2px;font-weight:700}
.axis-tag{display:inline-block;margin-right:5px;padding:0 5px;border-radius:8px;font-size:7.6px;font-weight:800;vertical-align:1px;color:#fff}
.axis-tag.market{background:#236aa6}.axis-tag.tech{background:#8b5a10}
.col .txt{margin:0 0 4px}
h2{margin:9px 0 5px;font-size:10.5px;color:#10365f;letter-spacing:.2px}
h2.tech-h{color:#8b5a10}h2.insight{color:#8b5a10}h2.check{color:#0c6b4e}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.col{padding:6px 8px;border:1px solid #dbe3ec;border-radius:6px}
.who{margin:0 0 2px;font-size:8.6px;font-weight:800;color:#1674c5}
.txt{margin:0}
.contrast{margin:5px 0 0;padding:5px 8px;background:#eaf3fb;border-radius:6px}
.tag{display:inline-block;margin-right:6px;padding:0 6px;border-radius:9px;background:#10365f;color:#fff;font-size:7.8px;font-weight:800;vertical-align:1px}
.point{margin:0 0 6px;padding:5px 8px;border:1px solid #e4dcc8;border-radius:6px;background:#fffdf6}
.lead{margin:0 0 2px;font-weight:800;color:#5a3d0a}
.seg{display:inline-block;margin-right:5px;padding:0 5px;border:1px solid #e4dcc8;border-radius:9px;font-size:7.8px;font-weight:800;color:#8b5a10;background:#fff;vertical-align:1px}
.basis{display:block;margin-top:2px;font-size:8.2px;color:#617187}
ul{margin:0;padding-left:12px}li{margin-bottom:3px}
.was{display:block;color:#9b3a3a;text-decoration:line-through}
.now{display:block;font-weight:700}
.none{margin:0;font-size:8.8px;color:#617187}
a{color:#1674c5;text-decoration:none;word-break:break-all}
footer{margin-top:9px;padding-top:5px;border-top:1px solid #dbe3ec;font-size:7.8px;color:#617187}
@media screen{body{max-width:186mm;margin:18px auto;padding:0 14px}}
`;
  const body = `<header><p class="eyebrow">CHINA BATTERY LENS · 기업 비교 리포트</p>
<h1>${A} vs ${B}</h1>
<p class="meta">근거 이벤트 ${payload.events_a}건 / ${payload.events_b}건 · 근거 범위: ${payload.include_supporting ? '공시·핵심 + 보조(참고) 데이터' : '공시·핵심 데이터만'} · 생성 ${escapeHtml(stamp)} · ${escapeHtml(payload.model || '')}</p></header>
${r.headline_ko ? `<p class="headline">${escapeHtml(r.headline_ko)}</p>` : ''}
<h2>1. 회사별 궤적 분석</h2><div class="pair">${trajCard(A, traj.a)}${trajCard(B, traj.b)}</div>
<h2>2. 궤적 비교</h2>${cmpRow('시장', 'market_ko')}${cmpRow('기술', 'technology_ko')}${cmpRow('갈린 지점', 'divergence_ko')}
<h2 class="insight">3. 한국 배터리사·소재사 관점 — 해석</h2>
${points || '<p class="none">해석을 생성하지 못했습니다.</p>'}
<h2 class="check">4. 웹 검증</h2>
<p class="txt">${escapeHtml(check.checked_ko || '검증 정보 없음')}</p>
${fixes ? `<p class="who" style="margin-top:4px">수정</p><ul>${fixes}</ul>` : '<p class="none">초안에서 고칠 사실관계를 찾지 못했습니다.</p>'}
${added ? `<p class="who" style="margin-top:4px">검색으로 새로 확인한 사실</p><ul>${added}</ul>` : ''}
<footer>1~2장은 수집된 사실 정리, 3장은 해석입니다. 투자 판단 자료가 아닙니다. ${escapeHtml(dbLine)}</footer>`;
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
async function generateCompareReport(){
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
        companyA: lastComparison.a, companyB: lastComparison.b,
        eventsA: lastComparison.eventsA.map(event => ({ id: event.id, date: event.date, track: event.track, title: event.title, fact: event.fact, sourceName: event.sourceName })),
        eventsB: lastComparison.eventsB.map(event => ({ id: event.id, date: event.date, track: event.track, title: event.title, fact: event.fact, sourceName: event.sourceName }))
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
  const dates = [...new Set([...eventsA, ...eventsB].map(event => displayDate(event)))]
    .sort((x, y) => sortKeyOf(eventsA, eventsB, y).localeCompare(sortKeyOf(eventsA, eventsB, x)));
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
      const metrics = keyMetrics(event);
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
  target.innerHTML = `<section class="compare-card" style="padding:22px;overflow-x:auto"><div style="min-width:1080px">${asym}<div style="display:grid;${COLS};align-items:end;margin-bottom:4px"><div style="grid-column:1/3"><p class="eyebrow">기업 A</p><h2>${escapeHtml(displayName(a))}</h2><p class="coverage-note">${escapeHtml(covA)}</p></div><div style="text-align:center;color:#617187;font-size:12px">공통<br>시간축</div><div style="grid-column:4/6;text-align:right"><p class="eyebrow">기업 B</p><h2>${escapeHtml(displayName(b))}</h2><p class="coverage-note">${escapeHtml(covB)}</p></div></div><div style="display:grid;${COLS};margin-bottom:10px"><div class="cmp-tracklabel tech" style="text-align:right">기술</div><div class="cmp-tracklabel market" style="text-align:right">시장</div><div></div><div class="cmp-tracklabel market">시장</div><div class="cmp-tracklabel tech">기술</div></div><div style="position:relative">${dates.map((date, index) => `<div style="display:grid;${COLS};align-items:center;min-height:104px"><div>${eventCell(eventsA, date, 'tech', 'right', a)}</div><div>${eventCell(eventsA, date, 'market', 'right', a)}</div><div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">${index < dates.length - 1 ? '<span style="position:absolute;top:50%;bottom:-52px;border-left:2px solid #b8c9d9"></span>' : ''}<span style="position:relative;width:14px;height:14px;border-radius:50%;background:#10365f;border:3px solid #eaf3fb"></span><time style="position:relative;margin-top:5px;color:#617187;font-size:12px;font-weight:700">${date}</time></div><div>${eventCell(eventsB, date, 'market', 'left', b)}</div><div>${eventCell(eventsB, date, 'tech', 'left', b)}</div></div>`).join('')}</div><p style="margin:8px 0 0;text-align:center;color:#617187;font-size:12px">과거 ↓</p></div></section>`;
}
function activateView(view){
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('is-visible', el.id === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('is-active',el.dataset.view===view));
  // 히스토리는 다른 기기·다른 탭에서도 쌓이므로 비교 화면에 들어올 때마다 다시 읽는다.
  if (view === 'compare') loadCompareReportHistory();
}
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => activateView(link.dataset.view)));


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
    button.disabled = false; button.textContent = '수집·분석 1회 실행';
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
  if (!(await confirmAccessCode('시계열 백필 1회 실행'))) return;
  if (!window.confirm('정기보고서 읽기·보강·시점 재확인을 20~30분 동안 돌립니다. 완료될 때까지 이 탭을 열어 두세요. LLM 호출이 많으니 필요할 때만 실행하세요. 시작할까요?')) return;
  const button = document.querySelector('#run-backfill-button');
  button.disabled = true; button.textContent = '백필 시작 중…';
  try {
    let completed = 0;
    let lastTask = '';
    for (let hop = 1; hop <= 40; hop += 1) {
      button.textContent = `시계열 백필 진행 중 (${hop}/40)`;
      const result = await fetch(`/api/ingest-rss?curate_step=1&hop=${hop}`, { method: 'POST' });
      const payload = await result.json();
      if (!result.ok) throw new Error([payload.status, payload.message].filter(Boolean).join(' · ') || `홉 ${hop} 요청 실패`);
      completed = hop;
      lastTask = payload.task || lastTask;
      if (!payload.more) break;
    }
    companyTimelineCache.clear();
    await renderCompany();
    window.alert(`시계열 백필을 완료했습니다.\n실행 ${completed}단계 · 마지막 작업 ${lastTask || '없음'}`);
    button.disabled = false; button.textContent = '시계열 백필 1회 실행';
  } catch (error) {
    window.alert(`백필 실행 중 실패했습니다: ${error.message}`);
    button.disabled = false; button.textContent = '시계열 백필 1회 실행';
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
    button.disabled = false; button.textContent = '벡터DB 임베딩 채우기';
  }
}
async function initialize(){
  await loadCompanyCatalog();
  const compareA = document.querySelector('#compare-a');
  const compareB = document.querySelector('#compare-b');
  const firstIn = chain => companiesInValueChain(chain)[0]?.id || '';
  currentCompany = firstIn('cathode') || companyCatalog[0]?.id || '';
  const compareBId = firstIn('anode') || currentCompany;
  currentChain = companyById(currentCompany)?.value_chain || 'cathode';
  renderCompanyPicker();
  const chainA = currentChain, chainB = companyById(compareBId)?.value_chain || 'anode';
  makeSelect(compareA, currentCompany, chainA);
  makeSelect(compareB, compareBId, chainB);
  makeChainTabs(document.querySelector('#compare-chain-a'), chainA, chain => { makeSelect(compareA, '', chain); renderComparison(); });
  makeChainTabs(document.querySelector('#compare-chain-b'), chainB, chain => { makeSelect(compareB, '', chain); renderComparison(); });
  document.querySelector('#compare-report').addEventListener('click', generateCompareReport);
  // 목록은 비교 화면을 열 때 activateView가 읽는다. 첫 화면은 Daily라 여기서 미리 받아둘 이유가 없다.
  compareA.addEventListener('change', renderComparison);
  compareB.addEventListener('change', renderComparison);
  document.querySelector('#export-company-timeline').addEventListener('click', exportCompanyTimeline);
  document.querySelector('#run-backfill-button').addEventListener('click', runTimelineBackfill);
  document.querySelector('#run-embed-button').addEventListener('click', runEmbedBackfill);
  document.querySelector('#ask-form').addEventListener('submit', askKnowledge);
  document.querySelector('#news-more').addEventListener('click', () => { topNewsExpanded = !topNewsExpanded; renderTopNews(); });
  // 보조 데이터 토글은 기업 시계열 화면과 비교 화면 두 곳에 있고, 같은 상태를 공유한다.
  const supportingToggles = [document.querySelector('#include-supporting'), document.querySelector('#include-supporting-compare')].filter(Boolean);
  supportingToggles.forEach(box => {
    box.checked = includeSupporting;
    box.addEventListener('change', async () => {
      includeSupporting = box.checked;
      supportingToggles.forEach(other => { other.checked = includeSupporting; });
      await renderCompany();
      await renderComparison();
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
  document.querySelector('#sankey-from').value = localDate(-3);
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
