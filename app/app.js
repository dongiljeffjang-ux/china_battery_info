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
let approvedTop10 = [];
let approvedCompanyNews = [];
let pendingCandidates = [];
let rangeFlows = [];

function companyById(id){ return companyCatalog.find(company => company.id === id) || null; }
function displayName(id){ return companyById(id)?.name_ko || id; }
function companiesInValueChain(chain){ return companyCatalog.filter(company => company.value_chain === chain); }
function escapeHtml(value){ return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function renderDailySummary(){
  const facts = dailyReportFacts || ['아직 생성된 Daily Report가 없습니다. 수집·분석 1회 실행 후 Top 10 본문 분석 결과와 통합 리포트가 이 영역에 표시됩니다.'];
  document.querySelector('#daily-summary-list').innerHTML = facts.map(fact => `<li>${fact}</li>`).join('');
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
  if (!approvedTop10.length) {
    return;
  }
  approvedTop10.forEach((item, index) => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = `TOP ${index + 1}`; sector.classList.toggle('anode', false);
    node.querySelector('.confidence-tag').textContent = item.confidence;
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = `${displayName(item.company)} · ${item.title}`;
    node.querySelector('.news-fact').textContent = item.fact;
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
  rangeFlows.forEach(({company_id, keyword, direction}) => {
    const normalizedKeyword = normalizeSankeyKeyword(keyword);
    if (!normalizedKeyword || !['positive', 'negative'].includes(direction)) return;
    const key = `${company_id}\u0000${direction}\u0000${normalizedKeyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const flows = [...counts.entries()].map(([key, count]) => {
    const [company, direction, keyword] = key.split('\u0000'); return { company, direction, keyword, count };
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
    return `<path d="${curve(164, sy, 600, ky)}" fill="none" stroke="${color}" stroke-width="${Math.min(18, 3 + flow.count * 3)}" stroke-opacity=".58"/>`;
  }).join('');
  const nodes = (names, x, top, gap, fill, formatter = value => value) => names.map(name => {
    const y = yFor(names, name, top, gap);
    return `<g><rect x="${x}" y="${y}" width="190" height="24" rx="4" fill="${fill}"/><text x="${x + 8}" y="${y + 16}" fill="#14263d" font-size="11" font-weight="700">${formatter(name)}</text></g>`;
  }).join('');
  const signalNodes = selectedNodes.map(node => `<g><rect x="600" y="${nodeY(node)}" width="190" height="24" rx="4" fill="${node.direction === 'positive' ? '#e3f5ed' : '#fbe9e9'}"/><text x="608" y="${nodeY(node) + 16}" fill="#14263d" font-size="11" font-weight="700">${node.keyword} · ${node.count}건</text></g>`).join('');
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
    node.querySelector('.confidence-tag').textContent = item.confidence;
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.news-fact').textContent = item.fact;
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
    why: article.is_top10 ? '헤드라인 선별 후 본문 정독·팩트 요약 완료' : article.verification_status === 'pending' ? '미분석 수집 원문' : '분석된 회사 이벤트',
    confidence: article.verification_status === 'pending_review' ? '원문 본문 대조 팩트체크 완료' : article.verification_status === 'pending' ? '미분석' : article.source_tier || '검수 완료',
    url: article.canonical_url,
    sourceName: article.source_name,
    classification: classifyCandidate(article)
  };
}
async function loadDashboardFromApi(){
  try {
    const from = document.querySelector('#sankey-from')?.value;
    const to = document.querySelector('#sankey-to')?.value;
    const params = new URLSearchParams(); if (from) params.set('from', from); if (to) params.set('to', to);
    params.set('_', Date.now().toString());
    const result = await fetch(`/api/dashboard?${params}`, { cache: 'no-store' });
    if (!result.ok) return;
    const payload = await result.json();
    if (payload.status !== 'ok') return;
    approvedTop10 = (payload.top10 || []).map(mapDashboardArticle);
    approvedCompanyNews = (payload.companyNews || []).map(mapDashboardArticle)
      .filter(article => !approvedTop10.some(top10 => top10.url === article.url));
    pendingCandidates = (payload.pendingNews || []).map(mapDashboardArticle);
    rangeFlows = payload.flows || [];
    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\n+/).filter(Boolean);
    }
    renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  } catch {
    // 환경변수 미설정·DB 초기화 전에는 시드 화면을 유지한다.
  }
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
    date: String(event.occurred_at || '').slice(0, 10),
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
    excerptKo: event.original_excerpt_ko || ''
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
function quarterOf(date){
  const match = String(date).match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]} Q${Math.floor((Number(match[2]) - 1) / 3) + 1}` : null;
}
function periodOrder(period){
  const match = String(period).match(/^(\d{4}) Q(\d)$/);
  return match ? Number(match[1]) * 4 + Number(match[2]) : 0;
}
// 기본 축은 최근 3년 + 당해 분기이고, 그 밖의 확인된 이벤트가 있으면 해당 분기도 함께 연다.
function timelinePeriods(events){
  const now = new Date();
  const endYear = now.getFullYear();
  const endQuarter = Math.floor(now.getMonth() / 3) + 1;
  const periods = new Set();
  for (let year = endYear - 3; year <= endYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      if (year === endYear && quarter > endQuarter) break;
      periods.add(`${year} Q${quarter}`);
    }
  }
  events.forEach(event => { const period = quarterOf(event.date); if (period) periods.add(period); });
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
  const core = timeline.events.filter(event => event.eligibility === '핵심').length;
  if (state) {
    state.textContent = notice || (timeline.events.length
      ? `출처가 확인된 이벤트 ${timeline.events.length}건(핵심 ${core}건)을 표시합니다.`
      : '아직 확인된 이벤트가 없습니다. 수집·분석을 실행하면 이 화면에 누적됩니다.');
  }
  renderCompanyEvents(timeline);
  renderLayerMatrix(timeline);
}
function renderCompanyEvents(timeline){
  const grid = document.querySelector('#snapshot-grid');
  if (!timeline.events.length) {
    grid.innerHTML = `<p>${escapeHtml(timelineNotice(timeline.status) || EMPTY_CELL_NOTE)}</p>`;
    return;
  }
  grid.innerHTML = [...timeline.events].sort((a, b) => b.date.localeCompare(a.date)).map(event => {
    const tags = [event.date, event.group, event.label, event.both ? '시장·기술' : '', event.eligibility].filter(Boolean).join(' · ');
    return `<article class="snapshot ${event.track}"><span class="snapshot-year">${escapeHtml(tags)}</span><h3>${escapeHtml(event.title)}</h3><ul><li>${escapeHtml(event.fact)}</li>${event.excerptKo ? `<li>원문 번역: ${escapeHtml(event.excerptKo)}</li>` : ''}</ul><p style="margin:0;font-size:12px;color:#617187">${sourceLink(event)}</p></article>`;
  }).join('');
}
function renderLayerMatrix(timeline){
  const target = document.querySelector('#dual-track');
  const events = timeline.events;
  const notice = timelineNotice(timeline.status);
  if (!events.length) {
    target.innerHTML = `<p>${escapeHtml(notice || '선택한 기업에 확인된 이벤트가 아직 없습니다.')}</p>`;
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
    const matched = events.filter(event => row.match(event) && quarterOf(event.date) === period);
    if (!matched.length) return `<span style="color:#9aa7b6" title="${EMPTY_CELL_NOTE}">—</span>`;
    return matched.map(event => `<div style="margin-bottom:8px"><strong>${escapeHtml(event.title)}</strong><br><span style="color:#526277">${escapeHtml(event.fact)}</span><br>${sourceLink(event, '11px')}</div>`).join('');
  };
  const headCell = 'text-align:left;padding:10px;border-bottom:1px solid #dbe3ec';
  const stickyGroup = 'padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700;position:sticky;left:0;background:#fff;z-index:1';
  const stickyLayer = 'padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700;position:sticky;left:58px;background:#fff;z-index:1';
  const table = `<table style="width:100%;min-width:${periods.length * 170 + 320}px;border-collapse:collapse;font-size:12px"><thead><tr><th style="${headCell};position:sticky;left:0;background:#fff;z-index:1">구분</th><th style="${headCell};position:sticky;left:58px;background:#fff;z-index:1">레이어</th>${periods.map(period => `<th style="${headCell};white-space:nowrap">${period}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td style="${stickyGroup};color:${row.group === '시장' ? '#236aa6' : '#8b5a10'}">${row.group}</td><td style="${stickyLayer}">${escapeHtml(row.label)}</td>${periods.map(period => `<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;min-width:170px">${cell(row, period)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  target.innerHTML = `<div style="overflow-x:auto">${table}</div><p style="margin:10px 0 0;color:#617187;font-size:12px">빈 칸(—)은 해당 분기에 ${EMPTY_CELL_NOTE}을 뜻합니다. 사건이 없었다는 뜻이 아닙니다.</p>`;
}
async function exportCompanyTimeline(){
  if (!currentCompany) { window.alert('내보낼 기업이 선택되지 않았습니다.'); return; }
  const company = companyById(currentCompany);
  const timeline = await loadCompanyTimeline(currentCompany);
  if (!timeline.events.length) { window.alert(timelineNotice(timeline.status) || '내보낼 확인된 이벤트가 없습니다.'); return; }
  const rows = [['회사', '구분', '레이어', '시기', '발생일', '주요 사실', '상세', '지역', '시계열 등급', '출처', '출처 링크', '원문 발췌', '원문 한국어 번역']];
  [...timeline.events].sort((a, b) => a.date.localeCompare(b.date)).forEach(event => {
    rows.push([company.name_ko, event.group, event.label, quarterOf(event.date) || event.date.slice(0, 4), event.date, event.title, event.fact, event.region, event.eligibility, event.sourceName, event.sourceUrl, event.excerpt, event.excerptKo]);
  });
  if (window.XLSX) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{wch:20}, {wch:8}, {wch:18}, {wch:10}, {wch:12}, {wch:30}, {wch:70}, {wch:14}, {wch:12}, {wch:20}, {wch:55}, {wch:55}, {wch:55}];
    rows.slice(1).forEach((row, index) => { const cell = sheet[`K${index + 2}`]; if (cell && row[10]) cell.l = { Target: row[10] }; });
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
async function renderComparison(){
  const target = document.querySelector('#comparison-grid');
  const selectA = document.querySelector('#compare-a');
  const selectB = document.querySelector('#compare-b');
  const a = selectA.value, b = selectB.value;
  if (!a || !b) { target.innerHTML = '<p>비교할 기업 목록을 불러오지 못했습니다.</p>'; return; }
  target.innerHTML = '<p>이벤트를 불러오는 중…</p>';
  const [timelineA, timelineB] = await Promise.all([loadCompanyTimeline(a), loadCompanyTimeline(b)]);
  if (selectA.value !== a || selectB.value !== b) return;
  const eventsA = timelineA.events, eventsB = timelineB.events;
  const dates = [...new Set([...eventsA, ...eventsB].map(event => event.date))].sort().reverse();
  if (!dates.length) {
    target.innerHTML = `<p>${escapeHtml(timelineNotice(timelineA.status) || timelineNotice(timelineB.status) || '두 기업 모두 확인된 이벤트가 없습니다.')}</p>`;
    return;
  }
  const eventsAt = (events, date) => events.filter(event => event.date === date).map(event => `<div style="margin-bottom:7px"><strong>${escapeHtml(event.title)}</strong><br><span style="color:#526277;font-size:12px">${escapeHtml(event.fact)}</span><br>${sourceLink(event, '11px')}</div>`).join('');
  const eventCell = (events, date, side) => { const html = eventsAt(events, date); return `<div style="min-height:54px;padding:10px 12px;background:${html ? '#ffffff' : 'transparent'};border:${html ? '1px solid #dbe3ec' : '0'};border-radius:8px;text-align:${side};font-size:13px">${html || `<span style="color:#9aa7b6" title="${EMPTY_CELL_NOTE}">—</span>`}</div>`; };
  target.innerHTML = `<section class="compare-card" style="padding:22px;overflow-x:auto"><div style="min-width:900px"><div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:end;margin-bottom:14px"><div><p class="eyebrow">기업 A</p><h2>${escapeHtml(displayName(a))}</h2></div><div style="text-align:center;color:#617187;font-size:12px">공통 시간축<br>↑ 최근</div><div style="text-align:right"><p class="eyebrow">기업 B</p><h2>${escapeHtml(displayName(b))}</h2></div></div><div style="position:relative">${dates.map((date, index) => `<div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:center;min-height:104px"><div>${eventCell(eventsA, date, 'left')}</div><div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">${index < dates.length - 1 ? '<span style="position:absolute;top:50%;bottom:-52px;border-left:2px solid #b8c9d9"></span>' : ''}<span style="position:relative;width:14px;height:14px;border-radius:50%;background:#10365f;border:3px solid #eaf3fb"></span><time style="position:relative;margin-top:5px;color:#617187;font-size:12px;font-weight:700">${date}</time></div><div>${eventCell(eventsB, date, 'right')}</div></div>`).join('')}</div><p style="margin:8px 0 0;text-align:center;color:#617187;font-size:12px">과거 ↓</p></div></section>`;
}
function activateView(view){
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('is-visible', el.id === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('is-active',el.dataset.view===view));
}
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => activateView(link.dataset.view)));
document.querySelector('#refresh-button').addEventListener('click', async () => { companyTimelineCache.clear(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews(); await loadDashboardFromApi(); await renderCompany(); await renderComparison(); });
document.querySelector('#sankey-range-apply').addEventListener('click', loadDashboardFromApi);
document.querySelector('#run-collection-button').addEventListener('click', async () => {
  const button = document.querySelector('#run-collection-button');
  button.disabled = true; button.textContent = '수집·분석 중…';
  try {
    const result = await fetch('/api/ingest-rss?process=1', { method: 'POST' });
    const payload = await result.json();
    if (!result.ok) throw new Error([payload.status, payload.stage, payload.message].filter(Boolean).join(' · ') || '요청 실패');
    const outcomes = Object.entries(payload.outcome_counts || {}).map(([status, count]) => `${status} ${count}건`).join(' / ');
    window.alert(`Daily 분석 완료: 발견 ${payload.discovered}건 / 저장 ${payload.stored}건 / 헤드라인 Top ${payload.headline_selected || 0}건 / 본문 처리 ${payload.llm_processed || 0}건${outcomes ? `\n처리 결과: ${outcomes}` : ''}\n첫 화면을 최신 결과로 갱신합니다.`);
    companyTimelineCache.clear();
    await loadDashboardFromApi();
    await renderCompany();
    await renderComparison();
  } catch (error) {
    window.alert(`수집을 실행하지 못했습니다: ${error.message}`);
  } finally {
    button.disabled = false; button.textContent = '수집·분석 1회 실행';
  }
});
async function initialize(){
  await loadCompanyCatalog();
  const select = document.querySelector('#company-select');
  const compareA = document.querySelector('#compare-a');
  const compareB = document.querySelector('#compare-b');
  const firstIn = chain => companiesInValueChain(chain)[0]?.id || '';
  currentCompany = firstIn('cathode') || companyCatalog[0]?.id || '';
  const compareBId = firstIn('anode') || currentCompany;
  makeSelect(select, currentCompany);
  makeSelect(compareA, currentCompany);
  makeSelect(compareB, compareBId);
  select.addEventListener('change', () => { currentCompany = select.value; renderCompany(); });
  compareA.addEventListener('change', renderComparison);
  compareB.addEventListener('change', renderComparison);
  document.querySelector('#export-company-timeline').addEventListener('click', exportCompanyTimeline);
  document.querySelector('#export-raw-news').addEventListener('click', exportRawNews);
  const sankeyTo = new Date();
  const sankeyFrom = new Date(); sankeyFrom.setDate(sankeyFrom.getDate() - 30);
  document.querySelector('#sankey-from').value = sankeyFrom.toISOString().slice(0, 10);
  document.querySelector('#sankey-to').value = sankeyTo.toISOString().slice(0, 10);
  renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  await loadDashboardFromApi();
  await renderCompany();
  await renderComparison();
}
initialize();
