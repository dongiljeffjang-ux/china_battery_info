const valueChainLabels = { cell: '셀사', cathode: '양극재', anode: '음극재' };
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
    const chip = section.category
      ? `<p class="summary-cat ${summaryCategoryClass[section.category] || ''}">${escapeHtml(section.category)}</p>`
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
    return `<div class="summary-block">${section.category ? `<p class="summary-cat insight">${escapeHtml(section.category)}</p>` : ''}${blocks}</div>`;
  }).join('');
  target.innerHTML = `<div class="insight-head"><p class="eyebrow">INSIGHT</p><h3>한국 배터리사·소재사에 주는 의미</h3><span class="source-rule">사실이 아니라 해석입니다</span></div>${body}`;
}
function feedbackClientKey(){
  const key = 'cbl_feedback_client_key';
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
function attachFeedback(node, article){
  if (!article.id) return;
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
    node.querySelector('h3').textContent = `${displayName(item.company)} · ${item.title}`;
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
    node.querySelector('h3').textContent = `${displayName(item.company)} · ${item.title}`;
    node.querySelector('.news-fact').textContent = `분류 근거: 회사 별칭 매칭 / 제목 키워드 ‘${item.classification.event}’. 원문 본문과 출처 신뢰도는 아직 검증하지 않았습니다.`;
    node.querySelector('.impact-reason').textContent = `출처: ${item.sourceName || 'RSS'}`;
    node.querySelector('a').href = item.url;
    target.append(node);
  });
}
function renderHeadlineSankey(){
  const counts = new Map();
  // 왜 그 방향인지는 서버가 신호마다 판단해 내려준다. 화면은 그 근거를 모아 툴팁으로 보여준다.
  const reasons = new Map();
  rangeFlows.forEach(({company_id, keyword, direction, reason, title}) => {
    const normalizedKeyword = normalizeSankeyKeyword(keyword);
    if (!normalizedKeyword || !['positive', 'negative'].includes(direction)) return;
    const key = `${company_id}\u0000${direction}\u0000${normalizedKeyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (reason || title) {
      // 제목과 근거 문장을 줄을 나눠 담는다. 도착지 라벨만 되풀이하면 툴팁이 쓸모없다.
      const bucket = reasons.get(key) || [];
      const line = [title ? `· ${title}` : '', reason ? `  ${reason}` : ''].filter(Boolean).join('\n');
      if (bucket.length < 3 && !bucket.includes(line)) bucket.push(line);
      reasons.set(key, bucket);
    }
  });
  const flows = [...counts.entries()].map(([key, count]) => {
    const [company, direction, keyword] = key.split('\u0000');
    return { company, direction, keyword, count, reasons: reasons.get(key) || [] };
  });
  const target = document.querySelector('#headline-sankey');
  if (!flows.length) {
    target.innerHTML = '<p>선택 기간에 확대·축소 헤드라인 신호로 분류된 비-Top 10 기사가 없습니다.</p>';
    return;
  }
  const totals = new Map();
  flows.forEach(flow => { const key = `${flow.direction}\u0000${flow.keyword}`; totals.set(key, (totals.get(key) || 0) + flow.count); });
  const selectedNodes = ['positive', 'negative'].flatMap(direction => [...totals.entries()]
    .filter(([key]) => key.startsWith(`${direction}\u0000`))
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([key, count]) => ({ direction, keyword: key.split('\u0000')[1], count })));
  const visible = flows.filter(flow => selectedNodes.some(node => node.direction === flow.direction && node.keyword === flow.keyword));
  const sourceNames = [...new Set(visible.map(flow => flow.company))];
  const positiveNodes = selectedNodes.filter(node => node.direction === 'positive');
  const negativeNodes = selectedNodes.filter(node => node.direction === 'negative');
  const height = Math.max(300, sourceNames.length * 34 + 70, selectedNodes.length * 34 + 112);
  const yFor = (names, name, top, gap) => top + names.indexOf(name) * gap;
  const label = displayName;
  const curve = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 130} ${y1}, ${x2 - 130} ${y2}, ${x2} ${y2}`;
  const nodeY = node => node.direction === 'positive' ? 62 + positiveNodes.indexOf(node) * 34 : 96 + positiveNodes.length * 34 + negativeNodes.indexOf(node) * 34;
  const links = visible.map(flow => {
    const sy = yFor(sourceNames, flow.company, 48, 34) + 12;
    const node = selectedNodes.find(item => item.direction === flow.direction && item.keyword === flow.keyword);
    const ky = nodeY(node) + 12;
    const color = flow.direction === 'positive' ? '#398261' : '#bc5b5b';
    const tip = `${displayName(flow.company)} → ${flow.keyword} · ${flow.direction === 'positive' ? '확대' : '축소'} ${flow.count}건${flow.reasons.length ? `\n\n${flow.reasons.join('\n\n')}` : ''}`;
    return `<path d="${curve(164, sy, 600, ky)}" fill="none" stroke="${color}" stroke-width="${Math.min(18, 3 + flow.count * 3)}" stroke-opacity=".58" data-tip="${escapeHtml(tip)}"/>`;
  }).join('');
  const nodes = (names, x, top, gap, fill, formatter = value => value) => names.map(name => {
    const y = yFor(names, name, top, gap);
    return `<g><rect x="${x}" y="${y}" width="190" height="24" rx="4" fill="${fill}"/><text x="${x + 8}" y="${y + 16}" fill="#14263d" font-size="11" font-weight="700">${formatter(name)}</text></g>`;
  }).join('');
  const nodeReasons = node => {
    const lines = visible.filter(flow => flow.direction === node.direction && flow.keyword === node.keyword).flatMap(flow => flow.reasons);
    const unique = [...new Set(lines)].slice(0, 4);
    const head = `${node.keyword} · ${node.direction === 'positive' ? '확대' : '축소'} 신호 ${node.count}건`;
    return unique.length
      ? `${head}\n\n${unique.join('\n\n')}`
      : `${head}\n\n근거로 쓸 기사 요약이 없습니다. 수집·분석을 다시 실행하면 채워집니다.`;
  };
  const signalNodes = selectedNodes.map(node => `<g data-tip="${escapeHtml(nodeReasons(node))}"><rect x="600" y="${nodeY(node)}" width="190" height="24" rx="4" fill="${node.direction === 'positive' ? '#e3f5ed' : '#fbe9e9'}"/><text x="608" y="${nodeY(node) + 16}" fill="#14263d" font-size="11" font-weight="700">${escapeHtml(node.keyword)} · ${node.count}건</text></g>`).join('');
  target.innerHTML = `<svg viewBox="0 0 820 ${height}" role="img" aria-label="기업별 확대 및 축소 헤드라인 신호 흐름도" style="display:block;width:100%;height:auto;min-height:300px"><text x="14" y="20" fill="#617187" font-size="11" font-weight="700">기업</text><text x="600" y="20" fill="#398261" font-size="11" font-weight="700">확대 신호 · 상위 4</text><text x="600" y="${80 + positiveNodes.length * 34}" fill="#bc5b5b" font-size="11" font-weight="700">축소 신호 · 상위 4</text>${links}${nodes(sourceNames, 14, 48, 34, '#eaf3fb', label)}${signalNodes}</svg>`;
}
function normalizeSankeyKeyword(value){
  const keyword = String(value || '').replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!keyword) return null;
  const companyOnly = /^(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션)(?:[·,、\s/-]+(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션))*$/i;
  if (companyOnly.test(keyword)) return null;
  const compact = keyword.replace(/[\s·,，·-]/g, '').toLowerCase();
  if (/구이저우|贵州/.test(keyword) && /프로젝트|项目|일체화|통합/.test(keyword)) return '구이저우 소재 프로젝트';
  if (/홍콩|hk|h주/.test(keyword) && /상장|listing|ipo/.test(keyword)) return '홍콩 상장';
  if (/가동률|产能利用率|생산능력이용률/.test(keyword)) return '가동률';
  if (/(인산철|lfp|磷酸铁).*(양극|正极).*(판매|출하|销量|出货)/.test(keyword)) return 'LFP 양극재 판매·출하';
  if (/증설|扩产|产能/.test(keyword) && /양극|正极/.test(keyword)) return '양극재 증설';
  if (/증설|扩产|产能/.test(keyword) && /음극|负极/.test(keyword)) return '음극재 증설';
  if (/프로젝트|项目/.test(keyword) && compact.length < 7) return null;
  return keyword;
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
  const filtered = approvedCompanyNews.filter(item => item.valueChain === currentNewsValueChain && (currentNewsCompany === 'all' || item.company === currentNewsCompany));
  if (!filtered.length) target.innerHTML = `<p>${currentNewsCompany === 'all' ? valueChainLabels[currentNewsValueChain] : companyTarget.selectedOptions[0]?.textContent}의 자동 팩트체크 완료 뉴스가 아직 없습니다.</p>`;
  filtered.forEach(item => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = displayName(item.company); sector.classList.toggle('anode', false);
    const confidenceTag = node.querySelector('.confidence-tag'); confidenceTag.textContent = item.confidence; confidenceTag.title = item.confidenceTitle || '';
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
  return {
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
async function loadDashboardFromApi(){
  try {
    const from = document.querySelector('#sankey-from')?.value;
    const to = document.querySelector('#sankey-to')?.value;
    const params = new URLSearchParams(); if (from) params.set('from', from); if (to) params.set('to', to);
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
    approvedCompanyNews = (payload.companyNews || []).map(mapDashboardArticle)
      .filter(article => !approvedTop10.some(top10 => top10.url === article.url));
    pendingCandidates = (payload.pendingNews || []).map(mapDashboardArticle);
    rangeFlows = payload.flows || [];
    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\n+/).filter(Boolean);
    }
    dailyReportInsight = payload.report?.insight_ko ? payload.report.insight_ko.split(/\n+/).filter(Boolean) : null;
    renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  } catch {
    // 환경변수 미설정·DB 초기화 전에는 시드 화면을 유지한다.
  }
}
let currentChain = 'cathode';
let includeSupporting = false;

// 기업 시계열은 공시 원문에서 나온 사실과 핵심 등급 기사만 기본으로 보여준다.
// 참고 등급 기사와 웹 검색 백필은 '보조 데이터 포함'을 켤 때만 나온다.
const evidenceLabels = { annual_report: '연차보고서', periodic_report: '반기·분기보고서', article: '언론', web_backfill: '웹 검색' };
function isPrimaryEvidence(event){
  if (event.kind === 'annual_report' || event.kind === 'periodic_report') return true;
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
    const meta = [company.priority ? `SNE ${company.priority}위` : '순위 미확인', company.group ? `계열사 ${company.group.members_ko.length}` : ''].filter(Boolean).join(' · ');
    const full = [company.name_zh, company.name_en].filter(Boolean).join(' · ');
    return `<button class="company-chip ${company.value_chain} ${company.id === currentCompany ? 'is-selected' : ''}" type="button" data-company="${escapeHtml(company.id)}" title="${escapeHtml(full)}"><span class="chip-mark">${escapeHtml(mark)}</span><span class="chip-body"><span class="chip-name">${escapeHtml(company.name_ko)}</span><span class="chip-meta">${escapeHtml(meta)}</span></span></button>`;
  }).join('');
  tabs.querySelectorAll('[data-chain]').forEach(button => button.addEventListener('click', () => {
    currentChain = button.dataset.chain;
    renderCompanyPicker();
  }));
  chips.querySelectorAll('[data-company]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.company === currentCompany) return;
    currentCompany = button.dataset.company;
    renderCompanyPicker();
    renderCompany();
  }));
}
function makeSelect(select, selected){
  if (!companyCatalog.length) { select.innerHTML = '<option value="">기업 목록 없음</option>'; return; }
  select.innerHTML = companyCatalog.map(company => `<option value="${escapeHtml(company.id)}" ${company.id === selected ? 'selected' : ''}>${escapeHtml(company.name_ko)} · ${escapeHtml(valueChainLabels[company.value_chain] || '기타')}</option>`).join('');
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
  if (event.kind === 'annual_report' || event.kind === 'periodic_report') score += 3;
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

function renderCompanyEvents(timeline){
  const grid = document.querySelector('#snapshot-grid');
  const events = visibleEvents(timeline).filter(event => event.kind === 'annual_report' || event.kind === 'periodic_report');
  if (!events.length) {
    grid.innerHTML = `<p>${escapeHtml(timelineNotice(timeline.status) || '아직 읽어들인 정기보고서가 없습니다. 매일 밤 수집 뒤 자동으로 채워집니다.')}</p>`;
    return;
  }
  // 시점별로 묶고, 한 시점 안에서는 중요한 것부터 개조식 한 줄씩. 전문은 마우스를 올리면 뜬다.
  const groups = new Map();
  [...events].sort((a, b) => b.date.localeCompare(a.date)).forEach(event => {
    const label = displayDate(event);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(event);
  });
  grid.innerHTML = [...groups.entries()].map(([label, items]) => {
    const first = items[0];
    const head = [label, evidenceLabels[first.kind] || ''].filter(Boolean).join(' · ');
    const lines = [...items].sort((x, y) => importanceOf(y) - importanceOf(x)).map(event => {
      const metrics = keyMetrics(event);
      const tags = [event.label !== '미분류' ? event.label : '', entityLabel(event)].filter(Boolean).join(' · ');
      return `<li class="digest-item" data-tip="${escapeHtml(eventTip(event))}"><span class="cmp-title">${escapeHtml(event.title)}</span>${metrics ? `<span class="cmp-metric">${escapeHtml(metrics)}</span>` : ''}${tags ? `<span class="digest-tags">${escapeHtml(tags)}</span>` : ''} ${sourceLink(event, '11px')}</li>`;
    }).join('');
    return `<article class="snapshot digest ${first.track}"><span class="snapshot-year" data-tip="${escapeHtml(dateTip(first))}">${escapeHtml(head)}</span><ul class="digest-list">${lines}</ul></article>`;
  }).join('');
}
function renderLayerMatrix(timeline){
  const target = document.querySelector('#dual-track');
  const events = visibleEvents(timeline);
  const notice = timelineNotice(timeline.status);
  if (!events.length) {
    target.innerHTML = `<p>${escapeHtml(notice || '선택한 기업에 표시할 공시 기반 이벤트가 아직 없습니다.')}</p>`;
    return;
  }
  const periods = timelinePeriods(events);
  const rowsFor = (group, labels) => {
    const rows = Object.entries(labels).map(([key, label]) => ({ group, label, match: event => event.layer === key }));
    if (events.some(event => event.layer === UNCLASSIFIED_LAYER && event.group === group)) {
      rows.push({ group, label: '미분류', match: event => event.layer === UNCLASSIFIED_LAYER && event.group === group });
    }
    return rows;
  };
  const rows = [...rowsFor('시장', marketLayerLabels), ...rowsFor('기술', technologyLayerLabels)];
  const cell = (row, period) => {
    const matched = events.filter(event => row.match(event) && periodOf(event.date) === period);
    if (!matched.length) return `<span style="color:#9aa7b6" title="${EMPTY_CELL_NOTE}">—</span>`;
    // 셀에는 방향과 수치만 남긴다. 설명 문장은 마우스를 올렸을 때만 보여준다.
    return matched.map(event => {
      const tip = [event.fact, entityLabel(event) ? `발생 법인: ${entityLabel(event)}` : '', `출처: ${event.sourceName}`].filter(Boolean).join('\n\n');
      return `<div class="matrix-item" data-tip="${escapeHtml(tip)}"><strong>${escapeHtml(event.title)}</strong>${entityLabel(event) ? `<span class="matrix-entity">${escapeHtml(entityLabel(event))}</span>` : ''}${event.sourceUrl ? ` <a class="matrix-src" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ''}</div>`;
    }).join('');
  };
  const headCell = 'text-align:left;padding:10px;border-bottom:1px solid #dbe3ec';
  const stickyGroup = 'padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700;position:sticky;left:0;background:#fff;z-index:1';
  const stickyLayer = 'padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700;position:sticky;left:58px;background:#fff;z-index:1';
  const table = `<table style="width:100%;min-width:${periods.length * 168 + 300}px;border-collapse:collapse;font-size:12px"><thead><tr><th style="${headCell};position:sticky;left:0;background:#fff;z-index:1">구분</th><th style="${headCell};position:sticky;left:58px;background:#fff;z-index:1">레이어</th>${periods.map(period => `<th style="${headCell};white-space:nowrap">${period}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td style="${stickyGroup};color:${row.group === '시장' ? '#236aa6' : '#8b5a10'}">${row.group}</td><td style="${stickyLayer}">${escapeHtml(row.label)}</td>${periods.map(period => `<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;min-width:150px">${cell(row, period)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  target.innerHTML = `<div class="matrix-scroll" style="overflow-x:auto">${table}</div><p style="margin:10px 0 0;color:#617187;font-size:12px">처음에는 현재 시점(오른쪽 끝)이 보이고 왼쪽으로 밀면 과거입니다. 지난 연도는 상·하반기, 당해 연도는 분기로 나눕니다. 칸에는 방향과 수치만 적었습니다. 자세한 사실은 항목에 마우스를 올리면 보입니다. 빈 칸(—)은 그 구간에 ${EMPTY_CELL_NOTE}을 뜻하며 사건이 없었다는 뜻이 아닙니다.</p>`;
  // 시간축은 과거→현재 순서를 지키되, 처음 보이는 위치를 현재 시점(오른쪽 끝)으로 둔다.
  const scroller = target.querySelector('.matrix-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
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
  button.disabled = true; button.textContent = '찾는 중…';
  target.innerHTML = '<p class="ask-empty">근거를 검색하고 있습니다…</p>';
  try {
    const result = await fetch('/api/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, companyId: scoped ? currentCompany : null })
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
  const scopeNote = scoped ? `${displayName(currentCompany)} 근거 ${payload.matched}건에서 찾았습니다.` : `전체 기업 근거 ${payload.matched}건에서 찾았습니다.`;
  if (payload.sufficient && payload.answer_ko) {
    parts.push(`<p class="ask-answer">${escapeHtml(payload.answer_ko)}</p>`);
  }
  if (payload.conflicts_ko) {
    parts.push(`<div class="ask-block"><p class="ask-label conflict">상충하는 근거</p><p class="ask-answer">${escapeHtml(payload.conflicts_ko)}</p></div>`);
  }
  if (payload.guidance_ko) {
    parts.push(`<div class="ask-block"><p class="ask-label guide">${payload.sufficient ? '더 확인할 것' : '근거가 부족합니다 · 확인할 것'}</p><p class="ask-answer">${escapeHtml(payload.guidance_ko)}</p></div>`);
  }
  if (payload.sources?.length) {
    const items = payload.sources.map(source => {
      const head = [displayName(source.company_id), source.published_at, source.source_name].filter(Boolean).join(' · ');
      const link = source.source_url ? ` <a href="${escapeHtml(source.source_url)}" target="_blank" rel="noreferrer">원문</a>` : '';
      return `<li><span class="n">${source.n}</span>${escapeHtml(head)}${link}<br>${escapeHtml(source.excerpt)}</li>`;
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
      const links = article.article_company || [{company_id:'', company:{}}];
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
function compareReportHtml(payload){
  const r = payload.report || {};
  const insight = r.korea_insight || {};
  const check = r.verification || {};
  const db = payload.db_updates || {};
  const A = escapeHtml(payload.company_a), B = escapeHtml(payload.company_b);
  // 전략·시계열은 두 회사를 나란히 놓고 읽어야 차이가 보인다. 대비는 그 아래 한 줄로 묶는다.
  const pair = (section, contrastLabel, contrastKey) => `
    <div class="pair"><div class="col"><p class="who">${A}</p><p class="txt">${escapeHtml(section?.a_ko || '')}</p></div>
    <div class="col"><p class="who">${B}</p><p class="txt">${escapeHtml(section?.b_ko || '')}</p></div></div>
    ${section?.[contrastKey] ? `<p class="contrast"><span class="tag">${contrastLabel}</span>${escapeHtml(section[contrastKey])}</p>` : ''}`;
  const points = (insight.points || []).map(item => `
    <div class="point"><p class="lead"><span class="seg">${escapeHtml(item.segment || '')}</span>${escapeHtml(item.implication_ko || '')}</p>
    <p class="txt">${escapeHtml(item.point_ko || '')}</p><p class="basis">근거 · ${escapeHtml(item.basis_ko || '')}</p></div>`).join('');
  const fixes = (check.corrections || []).map(item => `
    <li><span class="was">${escapeHtml(item.original_ko || '')}</span><span class="now">${escapeHtml(item.corrected_ko || '')}</span><span class="basis">${escapeHtml(item.reason_ko || '')}${item.event_id ? ' · DB 이벤트 시점 수정 반영' : ''}</span></li>`).join('');
  const added = (check.added_evidence || []).map(item => `
    <li><strong>${escapeHtml(item.company === 'B' ? payload.company_b : payload.company_a)}</strong> · ${escapeHtml(item.occurred_at || '')} · ${escapeHtml(item.fact_ko || '')}<span class="basis">${escapeHtml(item.source_name || '')} · <a href="${escapeHtml(item.source_url || '')}">${escapeHtml(item.source_url || '')}</a></span></li>`).join('');
  const stamp = new Date(payload.generated_at || Date.now()).toLocaleString('ko-KR');
  const dbLine = payload.verification_status === 'draft_only'
    ? '웹 검증에 실패해 초안 상태입니다.'
    : `DB 반영 · 시점 수정 ${db.dates_fixed || 0}건 · 참고 이벤트 추가 ${db.events_added || 0}건`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${A} vs ${B} 비교 리포트</title><style>
@page{size:A4;margin:13mm 14mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Malgun Gothic","Noto Sans KR","Segoe UI",sans-serif;font-size:9.6px;line-height:1.6;color:#14263d}
header{border-bottom:2px solid #10365f;padding-bottom:6px;margin-bottom:9px}
.eyebrow{margin:0;font-size:8px;font-weight:800;letter-spacing:1.1px;color:#1674c5}
h1{margin:2px 0 3px;font-size:16px;letter-spacing:-.3px}
.meta{margin:0;font-size:8.2px;color:#617187}
.headline{margin:0 0 8px;padding:7px 10px;border-left:3px solid #10365f;background:#f3f6fa;font-size:10.2px;font-weight:700}
h2{margin:9px 0 5px;font-size:10.5px;color:#10365f;letter-spacing:.2px}
h2.insight{color:#8b5a10}h2.check{color:#0c6b4e}
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
</style></head><body>
<header><p class="eyebrow">CHINA BATTERY LENS · 기업 비교 리포트</p>
<h1>${A} vs ${B}</h1>
<p class="meta">근거 이벤트 ${payload.events_a}건 / ${payload.events_b}건 · 생성 ${escapeHtml(stamp)} · ${escapeHtml(payload.model || '')}</p></header>
${r.headline_ko ? `<p class="headline">${escapeHtml(r.headline_ko)}</p>` : ''}
<h2>1. 전략 비교</h2>${pair(r.strategy, '대비', 'contrast_ko')}
<h2>2. 시계열 비교</h2>${pair(r.timeline, '갈린 지점', 'divergence_ko')}
<h2 class="insight">3. 한국 배터리사·소재사 관점 — 해석</h2>
${points || '<p class="none">해석을 생성하지 못했습니다.</p>'}
<h2 class="check">4. 웹 검증</h2>
<p class="txt">${escapeHtml(check.checked_ko || '검증 정보 없음')}</p>
${fixes ? `<p class="who" style="margin-top:4px">수정</p><ul>${fixes}</ul>` : '<p class="none">초안에서 고칠 사실관계를 찾지 못했습니다.</p>'}
${added ? `<p class="who" style="margin-top:4px">검색으로 새로 확인한 사실</p><ul>${added}</ul>` : ''}
<footer>1~2장은 수집된 사실 정리, 3장은 해석입니다. 투자 판단 자료가 아닙니다. ${escapeHtml(dbLine)}</footer>
</body></html>`;
}

async function generateCompareReport(){
  if (!lastComparison || (!lastComparison.eventsA.length && !lastComparison.eventsB.length)) {
    window.alert('비교할 이벤트가 화면에 없습니다. 두 기업을 고른 뒤 다시 시도해 주세요.');
    return;
  }
  // 새 창은 클릭 직후에 열어야 한다. 요청을 기다린 뒤 열면 팝업 차단에 걸린다.
  const printWindow = window.open('', '_blank');
  if (printWindow) printWindow.document.write('<!doctype html><meta charset="utf-8"><title>비교 리포트 생성 중</title><p style="font-family:sans-serif;padding:24px;color:#617187">비교 리포트를 만들고 있습니다. 창을 닫지 마세요.</p>');
  const button = document.querySelector('#compare-report');
  button.disabled = true;
  showBusy('비교 리포트 생성 중', 'LLM이 두 기업을 비교하고, 웹 검색으로 사실관계를 한 번 대조합니다. 1분 정도 걸립니다.');
  try {
    const response = await fetch('/api/company', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'compare_report',
        companyA: lastComparison.a, companyB: lastComparison.b,
        eventsA: lastComparison.eventsA.map(event => ({ id: event.id, date: event.date, title: event.title, fact: event.fact, sourceName: event.sourceName })),
        eventsB: lastComparison.eventsB.map(event => ({ id: event.id, date: event.date, title: event.title, fact: event.fact, sourceName: event.sourceName }))
      })
    });
    const payload = await response.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    const html = compareReportHtml(payload);
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    } else {
      window.alert('팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.');
    }
  } catch (error) {
    if (printWindow) printWindow.close();
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
  const eventsAt = (events, date) => {
    const ranked = events.filter(event => displayDate(event) === date).sort((x, y) => importanceOf(y) - importanceOf(x));
    const shown = ranked.slice(0, CELL_LIMIT);
    const rest = ranked.length - shown.length;
    return shown.map(event => {
      const metrics = keyMetrics(event);
      return `<div class="cmp-item" data-tip="${escapeHtml(eventTip(event))}"><span class="cmp-title">${escapeHtml(event.title)}</span>${metrics ? `<span class="cmp-metric">${escapeHtml(metrics)}</span>` : ''}${event.sourceUrl ? ` <a class="matrix-src" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ''}</div>`;
    }).join('') + (rest > 0 ? `<div class="cmp-more">+${rest}건 (Excel 내보내기에서 전체 확인)</div>` : '');
  };
  const eventCell = (events, date, side) => { const html = eventsAt(events, date); return `<div class="cmp-cell" style="min-height:54px;padding:8px 10px;background:${html ? '#ffffff' : 'transparent'};border:${html ? '1px solid #dbe3ec' : '0'};border-radius:8px;text-align:${side};font-size:12px">${html || `<span style="color:#9aa7b6" title="${EMPTY_CELL_NOTE}">—</span>`}</div>`; };
  target.innerHTML = `<section class="compare-card" style="padding:22px;overflow-x:auto"><div style="min-width:900px"><div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:end;margin-bottom:14px"><div><p class="eyebrow">기업 A</p><h2>${escapeHtml(displayName(a))}</h2></div><div style="text-align:center;color:#617187;font-size:12px">공통 시간축<br>↑ 최근</div><div style="text-align:right"><p class="eyebrow">기업 B</p><h2>${escapeHtml(displayName(b))}</h2></div></div><div style="position:relative">${dates.map((date, index) => `<div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:center;min-height:104px"><div>${eventCell(eventsA, date, 'left')}</div><div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">${index < dates.length - 1 ? '<span style="position:absolute;top:50%;bottom:-52px;border-left:2px solid #b8c9d9"></span>' : ''}<span style="position:relative;width:14px;height:14px;border-radius:50%;background:#10365f;border:3px solid #eaf3fb"></span><time style="position:relative;margin-top:5px;color:#617187;font-size:12px;font-weight:700">${date}</time></div><div>${eventCell(eventsB, date, 'right')}</div></div>`).join('')}</div><p style="margin:8px 0 0;text-align:center;color:#617187;font-size:12px">과거 ↓</p></div></section>`;
}
function activateView(view){
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('is-visible', el.id === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('is-active',el.dataset.view===view));
}
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => {
  activateView(link.dataset.view);
  if (link.dataset.view === 'ledger') startFactLedger();
}));


// ── 전략 장부 ──────────────────────────────────────────────────────
// 서버는 사실(event_fact) 전체를 주고, 세고 고르는 일은 여기서 한다. 회사를 가로질러
// 같은 축(품목·지역·상대방·기간)으로 놓는 것이 이 화면의 전부다. 숫자는 원문 표기 그대로.
let ledgerData = null;
let ledgerLoading = false;
let ledgerTier = 'disclosure';
let ledgerFinChain = 'cell';
const TIER_RANK = { disclosure: 0, article: 1, web: 2 };
const FACT_TYPE_KO = { capacity: '생산능력', shipment: '출하', financial: '실적', customer: '고객', partnership: '제휴', site: '거점', spec: '스펙' };
const SEGMENT_KO = { ncm: '삼원', lfp: 'LFP', precursor: '전구체', anode: '음극', cell: '셀', ess: 'ESS', other: '기타' };
const SEGMENT_ORDER = ['ncm', 'lfp', 'precursor', 'anode', 'cell', 'ess'];
const STATUS_KO = { planned: '계획', under_construction: '건설중', operating: '가동', completed: '완료', suspended: '중단', unknown: '상태 미상' };
const TIER_KO = { disclosure: '공시', article: '기사', web: '웹(참고)' };
const KIND_KO = { oem: '완성차', cell: '셀사', material: '소재사', resource: '자원·정제', government: '정부', other: '기타' };
const STATUS_COLOR = { planned: '#7f77dd', under_construction: '#7f77dd', operating: '#1d9e75', completed: '#1d9e75', suspended: '#d85a30', unknown: '#888780' };
const KIND_COLOR = { oem: '#7f77dd', cell: '#378add', material: '#1d9e75', resource: '#ba7517', government: '#888780', other: '#b4b2a9' };
const KOREAN_HINTS = ['posco', '포스코', 'lg', '삼성sdi', 'samsung sdi', 'sk온', 'sk on', 'sk넥실리스', '에코프로', '엘앤에프', '현대', 'hyundai', '기아', 'kia'];
const REGIONS = [
  { key: 'americas', label: '아메리카', countries: ['미국', '캐나다', '멕시코', '브라질', '칠레', '아르헨티나', '볼리비아'] },
  { key: 'europe', label: '유럽·중동·아프리카', countries: ['헝가리', '독일', '프랑스', '스페인', '포르투갈', '영국', '폴란드', '체코', '슬로바키아', '이탈리아', '핀란드', '스웨덴', '노르웨이', '네덜란드', '튀르키예', '세르비아', '모로코', '남아프리카공화국', '사우디아라비아', '아랍에미리트', '이집트', '짐바브웨', '콩고민주공화국', '나미비아'] },
  { key: 'asia', label: '아시아·오세아니아', countries: ['한국', '일본', '인도네시아', '태국', '베트남', '말레이시아', '인도', '싱가포르', '필리핀', '호주', '대만', '홍콩'] },
];
function isKorean(name){ const n = String(name || '').toLowerCase(); return KOREAN_HINTS.some(h => n.includes(h)); }
function ledgerFacts(){ return (ledgerData?.facts || []).filter(f => TIER_RANK[f.source_tier] <= TIER_RANK[ledgerTier]); }
function factQty(f){ return f.quantity_text || (f.quantity !== null ? String(f.quantity) : '수량 미기재'); }
function ledgerCompanies(){ return companyCatalog.slice(); }

function factCard(f){
  const ev = f.event || {};
  const where = [f.country, f.city].filter(Boolean).join(' ');
  const rev = f.review_status || 'unreviewed';
  return `<article class="fact-card" data-fact="${f.id}"><div class="fact-side"><span>${escapeHtml(displayDate({ date: f.occurred_at, precision: ev.occurred_precision || 'day' }))}</span><span>${escapeHtml(displayName(f.company_id))}</span><span class="fact-tag tier-${f.source_tier}">${TIER_KO[f.source_tier]}</span>${f.agreement === 'conflict' ? '<span class="fact-tag agreement-conflict">검토 필요</span>' : ''}${rev === 'confirmed' ? '<span class="fact-tag review-confirmed">확인됨</span>' : ''}</div><div class="fact-main"><div class="fact-head"><span class="fact-tag">${FACT_TYPE_KO[f.fact_type] || f.fact_type}${f.segment && f.segment !== 'other' ? ` · ${SEGMENT_KO[f.segment]}` : ''}</span><strong>${escapeHtml(f.item || f.metric || f.relation || '')}</strong>${f.quantity_text ? `<strong>${escapeHtml(f.quantity_text)}</strong>` : ''}${f.status && f.status !== 'unknown' ? `<span class="fact-tag status-${f.status}">${STATUS_KO[f.status]}</span>` : ''}${where ? `<span>${escapeHtml(where)}</span>` : ''}${f.counterparty ? `<span>${escapeHtml(f.relation || '')} · ${escapeHtml(f.counterparty)}${f.counterparty_kind ? ` (${KIND_KO[f.counterparty_kind]})` : ''}</span>` : ''}${f.period ? `<span style="color:var(--muted)">${escapeHtml(f.period)}</span>` : ''}</div><div class="fact-excerpt">“${escapeHtml(f.excerpt)}”</div><div class="fact-foot"><span>${escapeHtml(ev.title_ko || '')}</span>${ev.source_url ? `<a href="${escapeHtml(ev.source_url)}" target="_blank" rel="noreferrer">원문 ↗</a>` : ''}<span class="fact-review"><button type="button" data-review="confirmed" class="${rev === 'confirmed' ? 'is-on' : ''}">맞음</button><button type="button" data-review="rejected">오류</button></span></div></div></article>`;
}

function showLedgerDetail(title, facts){
  const panel = document.querySelector('#ledger-detail');
  panel.hidden = false;
  const sorted = facts.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  panel.innerHTML = `<button type="button" class="ledger-detail-close" aria-label="닫기">닫기 ✕</button><h2>${escapeHtml(title)} <span style="font-size:12px;color:var(--muted);font-weight:500">· 사실 ${sorted.length}건</span></h2><div class="fact-list">${sorted.map(factCard).join('') || '<p class="fig-empty">확인된 사실이 없습니다.</p>'}</div>`;
  panel.querySelector('.ledger-detail-close').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('.fact-card');
    const factId = card.dataset.fact;
    const status = button.dataset.review === 'confirmed' && button.classList.contains('is-on') ? 'unreviewed' : button.dataset.review;
    try {
      const result = await fetch('/api/company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'fact_review', factId, status }) });
      if (!result.ok) throw new Error('저장 실패');
      const fact = ledgerData.facts.find(f => f.id === factId);
      if (status === 'rejected') { ledgerData.facts = ledgerData.facts.filter(f => f.id !== factId); card.remove(); renderFactLedger(); }
      else { fact.review_status = status; card.outerHTML = factCard(fact); showLedgerDetail(title, facts.filter(f => f.id !== factId).concat(status === 'rejected' ? [] : [fact])); }
    } catch (error) { window.alert(`검토를 저장하지 못했습니다: ${error.message}`); }
  }));
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ① 회사 × 품목. 셀에는 그 조합에서 가장 최근에 공표된 캐파 하나만 둔다. 합산은 이중계산이 된다.
function renderLedgerCapacity(facts){
  const target = document.querySelector('#ledger-capacity');
  const caps = facts.filter(f => f.fact_type === 'capacity' && f.segment !== 'other');
  if (!caps.length) { target.innerHTML = '<p class="fig-empty">아직 생산능력 사실이 없습니다.</p>'; return; }
  const latest = new Map();
  for (const f of caps.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))) {
    const key = `${f.company_id}|${f.segment}`;
    const prev = latest.get(key);
    // 수량 있는 최신값이 우선. 같은 날짜(같은 보고서)에 여럿이면 큰 값을 둔다 — 보통 그것이 기지 전체 규모다.
    // 수량 없는 사실만 있으면 그것을 회색 점으로 둔다.
    if (!prev || (prev.quantity === null && f.quantity !== null) || (prev.occurred_at === f.occurred_at && (f.quantity || 0) > (prev.quantity || 0))) latest.set(key, f);
  }
  const companies = ledgerCompanies().filter(c => SEGMENT_ORDER.some(seg => latest.has(`${c.id}|${seg}`)));
  const maxTon = Math.max(1, ...[...latest.values()].filter(f => /^t/.test(f.unit || '')).map(f => f.quantity || 0));
  const maxGwh = Math.max(1, ...[...latest.values()].filter(f => /GWh/.test(f.unit || '')).map(f => f.quantity || 0));
  const left = 150, colW = 118, rowH = 74, top = 34;
  const W = left + colW * SEGMENT_ORDER.length + 10, H = top + rowH * companies.length + 10;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="회사별 품목 생산능력">`;
  SEGMENT_ORDER.forEach((seg, i) => { svg += `<text x="${left + colW * i + colW / 2}" y="22" text-anchor="middle" font-size="12" font-weight="700" fill="#334a63">${SEGMENT_KO[seg]}</text>`; });
  svg += `<line x1="${left - 10}" x2="${W - 10}" y1="${top - 4}" y2="${top - 4}" stroke="#dbe3ec"/>`;
  companies.forEach((c, r) => {
    const y = top + rowH * r + rowH / 2;
    const reports = ledgerData.coverage?.[c.id] || 0;
    svg += `<text x="8" y="${y + 4}" font-size="12" font-weight="700" fill="#10365f" data-tip="${escapeHtml(`읽은 공시 ${reports}건`)}">${escapeHtml(c.name_ko.length > 12 ? c.name_ko.slice(0, 12) + '…' : c.name_ko)}</text>`;
    svg += `<line x1="${left - 10}" x2="${W - 10}" y1="${top + rowH * (r + 1)}" y2="${top + rowH * (r + 1)}" stroke="#edf1f4"/>`;
    SEGMENT_ORDER.forEach((seg, i) => {
      const f = latest.get(`${c.id}|${seg}`);
      const x = left + colW * i + colW / 2;
      if (!f) { svg += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="#c9d2dc">—</text>`; return; }
      let r0 = 6;
      if (f.quantity !== null) { const max = /GWh/.test(f.unit || '') ? maxGwh : maxTon; r0 = 8 + 20 * Math.sqrt(f.quantity / max); }
      const tip = `${c.name_ko} · ${SEGMENT_KO[seg]} · ${factQty(f)} · ${STATUS_KO[f.status] || ''} · ${[f.country, f.city].filter(Boolean).join(' ')} (${f.occurred_at})`;
      svg += `<g class="cap-cell" data-company="${c.id}" data-segment="${seg}" style="cursor:pointer" data-tip="${escapeHtml(tip)}"><circle cx="${x}" cy="${y - 6}" r="${r0.toFixed(1)}" fill="${STATUS_COLOR[f.status] || '#888780'}" opacity="0.85"/><text x="${x}" y="${y + r0 + 8}" text-anchor="middle" font-size="10.5" fill="#405167">${escapeHtml(f.quantity_text || '미기재')}${f.status && f.status !== 'unknown' ? ` · ${STATUS_KO[f.status]}` : ''}</text></g>`;
    });
  });
  svg += '</svg>';
  target.innerHTML = `${svg}<div class="fig-legend"><span><i style="background:#7f77dd"></i>계획·건설중</span><span><i style="background:#1d9e75"></i>가동·완료</span><span><i style="background:#d85a30"></i>중단</span><span><i style="background:#888780"></i>수량 미기재</span><span>· 회사명에 마우스를 올리면 읽은 공시 수</span></div>`;
  target.querySelectorAll('.cap-cell').forEach(cell => cell.addEventListener('click', () => {
    const list = caps.filter(f => f.company_id === cell.dataset.company && f.segment === cell.dataset.segment);
    showLedgerDetail(`${displayName(cell.dataset.company)} · ${SEGMENT_KO[cell.dataset.segment]} 생산능력`, list);
  }));
}

// ② 국가 타일. 중국 밖의 거점·증설·합작·고객을 국가로 묶고 대륙 순으로 놓는다.
function renderLedgerSites(facts){
  const target = document.querySelector('#ledger-sites');
  const abroad = facts.filter(f => f.country && f.country !== '중국' && ['capacity', 'site', 'partnership', 'customer', 'shipment'].includes(f.fact_type));
  if (!abroad.length) { target.innerHTML = '<p class="fig-empty">아직 해외 거점 사실이 없습니다.</p>'; return; }
  const byCountry = new Map();
  for (const f of abroad) { if (!byCountry.has(f.country)) byCountry.set(f.country, []); byCountry.get(f.country).push(f); }
  const regionOf = country => REGIONS.find(r => r.countries.includes(country))?.key || 'other';
  const groups = [...REGIONS, { key: 'other', label: '기타 지역', countries: [] }].map(region => ({ ...region, list: [...byCountry.entries()].filter(([c]) => regionOf(c) === region.key).sort((a, b) => b[1].length - a[1].length) })).filter(g => g.list.length);
  const tileW = 176, tileH = 96, gap = 10, cols = 3;
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">';
  for (const g of groups) {
    const rows = Math.ceil(g.list.length / cols);
    const W = cols * (tileW + gap), H = 20 + rows * (tileH + gap);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${g.label} 거점"><text x="0" y="12" font-size="11" font-weight="700" fill="#617187">${g.label}</text>`;
    g.list.forEach(([country, list], i) => {
      const x = (i % cols) * (tileW + gap), y = 20 + Math.floor(i / cols) * (tileH + gap);
      const suspended = list.some(f => f.status === 'suspended');
      const korea = country === '한국';
      const fill = suspended ? '#faece7' : korea ? '#faeeda' : '#e6f1fb';
      const stroke = suspended ? '#d85a30' : korea ? '#ba7517' : '#378add';
      const ink = suspended ? '#712b13' : korea ? '#633806' : '#0c447c';
      const companies = [...new Set(list.map(f => f.company_id))];
      const lines = list.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 3).map(f => `${displayName(f.company_id).replace(/\(.*\)/, '').trim()} · ${f.item || f.counterparty || FACT_TYPE_KO[f.fact_type]}${f.quantity_text ? ` ${f.quantity_text}` : ''}`);
      svg += `<g class="site-tile" data-country="${escapeHtml(country)}" style="cursor:pointer" data-tip="${escapeHtml(`${country} · 회사 ${companies.length}곳 · 사실 ${list.length}건`)}"><rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="6" fill="${fill}" stroke="${stroke}"/><text x="${x + 10}" y="${y + 18}" font-size="12" font-weight="700" fill="${ink}">${escapeHtml(country)} <tspan font-weight="500" fill="${stroke}">${list.length}</tspan></text>${lines.map((line, j) => `<text x="${x + 10}" y="${y + 38 + j * 16}" font-size="10.5" fill="${ink}">${escapeHtml(line.length > 27 ? line.slice(0, 27) + '…' : line)}</text>`).join('')}${list.length > 3 ? `<text x="${x + 10}" y="${y + 88}" font-size="10" fill="${stroke}">+${list.length - 3}건</text>` : ''}</g>`;
    });
    svg += '</svg>';
    html += `<div>${svg}</div>`;
  }
  html += `</div><div class="fig-legend"><span><i class="sq" style="background:#e6f1fb;border:1px solid #378add"></i>거점</span><span><i class="sq" style="background:#faece7;border:1px solid #d85a30"></i>중단·지연 포함</span><span><i class="sq" style="background:#faeeda;border:1px solid #ba7517"></i>한국</span></div>`;
  target.innerHTML = html;
  target.querySelectorAll('.site-tile').forEach(tile => tile.addEventListener('click', () => showLedgerDetail(`${tile.dataset.country} 거점`, byCountry.get(tile.dataset.country) || [])));
}

// ③ 왼쪽 중국 회사, 오른쪽 상대방. 선 굵기는 사실 수, 색은 상대방 종류, 한국 기업은 상자를 강조.
function renderLedgerLinks(facts){
  const target = document.querySelector('#ledger-links');
  const rel = facts.filter(f => f.counterparty && ['customer', 'partnership'].includes(f.fact_type));
  if (!rel.length) { target.innerHTML = '<p class="fig-empty">아직 고객·제휴 사실이 없습니다.</p>'; return; }
  const pairs = new Map();
  for (const f of rel) { const k = `${f.company_id}|${f.counterparty}`; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(f); }
  const leftIds = ledgerCompanies().map(c => c.id).filter(id => rel.some(f => f.company_id === id));
  const rightCount = new Map();
  for (const f of rel) rightCount.set(f.counterparty, (rightCount.get(f.counterparty) || 0) + 1);
  const rights = [...rightCount.entries()].sort((a, b) => (isKorean(b[0]) - isKorean(a[0])) || b[1] - a[1]).map(([n]) => n);
  const rowH = 30, boxW = 170, W = 760, H = 24 + Math.max(leftIds.length, rights.length) * rowH;
  const yL = i => 24 + i * rowH * (Math.max(leftIds.length, rights.length) / leftIds.length) ;
  const yR = i => 24 + i * rowH * (Math.max(leftIds.length, rights.length) / rights.length);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="중국 회사와 상대방 연결도">`;
  for (const [key, list] of pairs) {
    const [cid, cp] = key.split('|');
    const a = yL(leftIds.indexOf(cid)) + 11, b = yR(rights.indexOf(cp)) + 11;
    const kind = list[0].counterparty_kind || 'other';
    const tip = `${displayName(cid)} → ${cp}: ${[...new Set(list.map(f => f.relation).filter(Boolean))].join(', ') || '관계'} · ${list.length}건`;
    svg += `<path class="link-line" data-pair="${escapeHtml(key)}" d="M${boxW} ${a} C ${W / 2} ${a}, ${W / 2} ${b}, ${W - boxW} ${b}" fill="none" stroke="${isKorean(cp) ? '#ba7517' : KIND_COLOR[kind]}" stroke-width="${Math.min(7, 1.2 + list.length * 1.1)}" opacity="0.75" style="cursor:pointer" data-tip="${escapeHtml(tip)}"/>`;
  }
  leftIds.forEach((id, i) => { const y = yL(i); svg += `<g class="link-left" data-company="${id}" style="cursor:pointer"><rect x="0" y="${y}" width="${boxW}" height="22" rx="5" fill="#eeedfe" stroke="#7f77dd"/><text x="${boxW / 2}" y="${y + 15}" text-anchor="middle" font-size="11" font-weight="700" fill="#3c3489">${escapeHtml(displayName(id).length > 16 ? displayName(id).slice(0, 16) + '…' : displayName(id))}</text></g>`; });
  rights.forEach((name, i) => { const y = yR(i); const ko = isKorean(name); svg += `<g class="link-right" data-cp="${escapeHtml(name)}" style="cursor:pointer"><rect x="${W - boxW}" y="${y}" width="${boxW}" height="22" rx="5" fill="${ko ? '#faeeda' : '#f1efe8'}" stroke="${ko ? '#ba7517' : '#b4b2a9'}"/><text x="${W - boxW / 2}" y="${y + 15}" text-anchor="middle" font-size="11" font-weight="700" fill="${ko ? '#633806' : '#444441'}">${escapeHtml(name.length > 18 ? name.slice(0, 18) + '…' : name)}</text></g>`; });
  svg += '</svg>';
  target.innerHTML = `${svg}<div class="fig-legend">${Object.entries(KIND_KO).filter(([k]) => rel.some(f => f.counterparty_kind === k)).map(([k, label]) => `<span><i style="background:${KIND_COLOR[k]}"></i>${label}</span>`).join('')}<span><i style="background:#ba7517"></i>한국 기업</span></div>`;
  target.querySelectorAll('.link-line').forEach(line => line.addEventListener('click', () => { const [cid, cp] = line.dataset.pair.split('|'); showLedgerDetail(`${displayName(cid)} ↔ ${cp}`, pairs.get(line.dataset.pair)); }));
  target.querySelectorAll('.link-left').forEach(box => box.addEventListener('click', () => showLedgerDetail(`${displayName(box.dataset.company)} · 고객·제휴`, rel.filter(f => f.company_id === box.dataset.company))));
  target.querySelectorAll('.link-right').forEach(box => box.addEventListener('click', () => showLedgerDetail(`${box.dataset.cp} · 관계된 중국 회사`, rel.filter(f => f.counterparty === box.dataset.cp))));
}

// ④ 같은 지표를 같은 축에. 기간(period)이 있는 실적만 쓰고, 회사마다 기간별 최신 사실 하나.
function renderLedgerFinancials(facts){
  const target = document.querySelector('#ledger-financials');
  const metric = document.querySelector('#ledger-fin-metric').value;
  const chainIds = new Set(companiesInValueChain(ledgerFinChain).map(c => c.id));
  const pick = f => chainIds.has(f.company_id) && f.period && f.quantity !== null && (metric === 'shipment' ? f.fact_type === 'shipment' : (f.fact_type === 'financial' && f.metric === metric && f.unit === 'CNY_100M'));
  const rows = facts.filter(pick);
  if (!rows.length) { target.innerHTML = '<p class="fig-empty">이 지표의 사실이 아직 없습니다.</p>'; return; }
  const periods = [...new Set(rows.map(f => f.period))].sort();
  const series = new Map();
  for (const f of rows.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) { if (!series.has(f.company_id)) series.set(f.company_id, new Map()); series.get(f.company_id).set(f.period, f); }
  const unitLabel = metric === 'shipment' ? [...new Set(rows.map(f => f.unit))].join('/') : '억 위안';
  const W = 760, H = 260, left = 56, right = 150, top = 14, bottom = 34;
  const max = Math.max(1, ...rows.map(f => f.quantity)), min = Math.min(0, ...rows.map(f => f.quantity));
  const x = i => left + (W - left - right) * (periods.length === 1 ? 0.5 : i / (periods.length - 1));
  const y = v => top + (H - top - bottom) * (1 - (v - min) / (max - min || 1));
  const palette = ['#10365f', '#1d9e75', '#d85a30', '#7f77dd', '#ba7517', '#378add', '#d4537e', '#639922', '#888780'];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="실적 추이">`;
  for (const t of [min, (min + max) / 2, max]) svg += `<line x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}" stroke="#edf1f4"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="#8b98a8">${Math.round(t).toLocaleString()}</text>`;
  periods.forEach((p, i) => { svg += `<text x="${x(i)}" y="${H - bottom + 16}" text-anchor="middle" font-size="10.5" fill="#617187">${escapeHtml(p)}</text>`; });
  let k = 0;
  for (const [cid, byPeriod] of series) {
    const color = palette[k % palette.length]; k += 1;
    const pts = periods.map((p, i) => byPeriod.has(p) ? { i, f: byPeriod.get(p) } : null).filter(Boolean);
    if (pts.length > 1) svg += `<polyline points="${pts.map(pt => `${x(pt.i)},${y(pt.f.quantity)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const pt of pts) svg += `<circle cx="${x(pt.i)}" cy="${y(pt.f.quantity)}" r="4" fill="${color}" class="fin-pt" data-fact="${pt.f.id}" style="cursor:pointer" data-tip="${escapeHtml(`${displayName(cid)} ${pt.f.period}: ${pt.f.quantity_text} (${TIER_KO[pt.f.source_tier]})`)}"/>`;
    const last = pts[pts.length - 1];
    svg += `<text x="${x(last.i) + 8}" y="${y(last.f.quantity) + 4}" font-size="10.5" fill="${color}" font-weight="700">${escapeHtml(displayName(cid).replace(/\(.*\)/, '').trim())}</text>`;
  }
  svg += '</svg>';
  target.innerHTML = `${svg}<div class="fig-legend"><span>단위: ${escapeHtml(unitLabel)} · 원문 표기 그대로, 환산 없음 · 점을 클릭하면 근거</span></div>`;
  target.querySelectorAll('.fin-pt').forEach(pt => pt.addEventListener('click', () => { const f = rows.find(r => r.id === pt.dataset.fact); showLedgerDetail(`${displayName(f.company_id)} · ${f.period} ${FACT_TYPE_KO[f.fact_type]}`, [f]); }));
}

function renderFactLedger(){
  if (!ledgerData) return;
  const facts = ledgerFacts();
  const status = document.querySelector('#ledger-status');
  const pending = ledgerData.pending_events || 0;
  status.textContent = `사실 ${facts.length}건 (전체 ${ledgerData.facts.length}건)${pending ? ` · 추출 대기 이벤트 ${pending}건 — 야간 유지 단계가 채웁니다` : ''}`;
  renderLedgerCapacity(facts);
  renderLedgerSites(facts);
  renderLedgerLinks(facts);
  renderLedgerFinancials(facts);
}

async function startFactLedger(){
  const chainBox = document.querySelector('#ledger-fin-chain');
  if (!chainBox.children.length) {
    chainBox.innerHTML = Object.entries(valueChainLabels).map(([key, label]) => `<button type="button" class="segment${key === ledgerFinChain ? ' is-selected' : ''}" data-chain="${key}">${label}</button>`).join('');
    chainBox.querySelectorAll('.segment').forEach(button => button.addEventListener('click', () => { ledgerFinChain = button.dataset.chain; chainBox.querySelectorAll('.segment').forEach(b => b.classList.toggle('is-selected', b === button)); renderLedgerFinancials(ledgerFacts()); }));
    document.querySelector('#ledger-fin-metric').addEventListener('change', () => renderLedgerFinancials(ledgerFacts()));
    document.querySelector('#ledger-tier').addEventListener('change', event => { ledgerTier = event.target.value; renderFactLedger(); });
  }
  if (ledgerData) { renderFactLedger(); return; }
  if (ledgerLoading) return;
  ledgerLoading = true;
  document.querySelector('#ledger-status').textContent = '불러오는 중…';
  try {
    const result = await fetch('/api/company?mode=fact_ledger', { cache: 'no-store' });
    const payload = await result.json();
    if (payload.status !== 'ok') throw new Error(payload.message || payload.status);
    ledgerData = payload;
    renderFactLedger();
  } catch (error) {
    document.querySelector('#ledger-status').textContent = `불러오지 못했습니다: ${error.message}`;
  } finally {
    ledgerLoading = false;
  }
}

document.querySelector('#refresh-button').addEventListener('click', async () => { companyTimelineCache.clear(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews(); renderCompanyPicker(); await loadDashboardFromApi(); await renderCompany(); await renderComparison(); });
document.querySelector('#sankey-range-apply').addEventListener('click', loadDashboardFromApi);
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
async function initialize(){
  await loadCompanyCatalog();
  const compareA = document.querySelector('#compare-a');
  const compareB = document.querySelector('#compare-b');
  const firstIn = chain => companiesInValueChain(chain)[0]?.id || '';
  currentCompany = firstIn('cathode') || companyCatalog[0]?.id || '';
  const compareBId = firstIn('anode') || currentCompany;
  currentChain = companyById(currentCompany)?.value_chain || 'cathode';
  renderCompanyPicker();
  makeSelect(compareA, currentCompany);
  makeSelect(compareB, compareBId);
  document.querySelector('#compare-report').addEventListener('click', generateCompareReport);
  compareA.addEventListener('change', renderComparison);
  compareB.addEventListener('change', renderComparison);
  document.querySelector('#export-company-timeline').addEventListener('click', exportCompanyTimeline);
  document.querySelector('#ask-form').addEventListener('submit', askKnowledge);
  document.querySelector('#news-more').addEventListener('click', () => { topNewsExpanded = !topNewsExpanded; renderTopNews(); });
  const supporting = document.querySelector('#include-supporting');
  supporting.checked = includeSupporting;
  supporting.addEventListener('change', async () => {
    includeSupporting = supporting.checked;
    await renderCompany();
    await renderComparison();
  });
  document.querySelector('#export-raw-news').addEventListener('click', exportRawNews);
  // toISOString은 UTC 날짜를 준다. 한국은 UTC+9라 오전에는 하루 뒤처진 날짜가 잡혀
  // 오늘 기사가 기간에서 빠진다. 현지 날짜 구성요소로 직접 만든다.
  const localDate = (offsetDays) => {
    const day = new Date(); day.setDate(day.getDate() + offsetDays);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  };
  document.querySelector('#sankey-from').value = localDate(-30);
  document.querySelector('#sankey-to').value = localDate(0);
  renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  await loadDashboardFromApi();
  await renderCompany();
  await renderComparison();
}
initialize();
