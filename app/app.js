const source = {
  catl: 'https://www.catl.com/en/news/6773.html',
  byd: 'https://www.byd.com/mea/news-list/BYD%20Unveils%202nd%20Generation%20Blade%20Battery%20and%20FLASH%20Charging%20Technology',
  ronbay: 'https://dataclouds.cninfo.com.cn/shgonggao/hsomarket/2026/20260429/8cca73c706de46c8b79911eef8974ae7.PDF',
  btr: 'https://dataclouds.cninfo.com.cn/sjother2/bse_onmarket/2026/20260424/90c2206e3ff011f18c72fa163e296ac0.pdf',
  shanshan: 'https://static.cninfo.com.cn/finalpage/2026-08-28/1225521372.PDF'
};

let news = [
  {sector:'cathode', company:'Ronbay', date:'2026.04.29', title:'구이저우 전구체·양극재 증설 착수', fact:'연 52만 톤 전구체와 연 34만 톤 양극재 생산능력 건설을 시작했다고 공시.', why:'양극재 공급능력·제품 포트폴리오 변화', confidence:'거래소 공시', url:source.ronbay},
  {sector:'anode', company:'BTR', date:'2026.06.23', title:'인도네시아 음극재 1기 가동, 모로코 프로젝트 착수', fact:'인도네시아 연 8만 톤 음극재 프로젝트가 가동됐고, 모로코 음극·양극 프로젝트를 시작했다고 발표.', why:'해외 공급망과 현지 생산 변화', confidence:'회사 공식', url:source.btr},
  {sector:'cathode', company:'CATL', date:'2026.03.10', title:'글로벌 생산능력 772GWh·건설 중 321GWh 공개', fact:'CATL이 2025년 연차보고서에서 글로벌 캐파와 건설 중 캐파를 공개.', why:'소재 수요처의 중장기 투자 신호', confidence:'회사 공식', url:source.catl},
  {sector:'anode', company:'Shanshan', date:'2026.08.28', title:'중국 음극재 출하량 48% 증가·가동률 80% 이상', fact:'Shanshan 반기보고서가 GGII 인용으로 출하·가동률 변화를 제시.', why:'음극재 업황·가동률 변화', confidence:'거래소 공시', url:source.shanshan},
  {sector:'cathode', company:'BYD', date:'2026.03.05', title:'2세대 블레이드 배터리와 FLASH 충전 공개', fact:'BYD가 2세대 블레이드 배터리와 2만 개 FLASH 충전소 건설 계획을 발표.', why:'LFP 수요처의 제품·충전 전략 변화', confidence:'회사 공식', url:source.byd},
  {sector:'anode', company:'BTR', date:'2026.04.24', title:'CVD 실리콘탄소 제품 양산 출하 사실 공시', fact:'글로벌 주요 동력 고객 인정을 받아 CVD 실리콘탄소 제품을 양산 출하했다고 공시.', why:'실리콘 음극의 고객·출하 팩트', confidence:'거래소 공시', url:source.btr}
];

const headlineFlows = [
  {company:'Ronbay', event:'증설·생산', signal:'양극재 공급'},
  {company:'BTR', event:'해외 생산', signal:'음극재 공급'},
  {company:'CATL', event:'캐파 공개', signal:'셀 수요 신호'},
  {company:'Shanshan', event:'출하·가동률', signal:'음극재 수급'},
  {company:'BYD', event:'제품·충전', signal:'셀 수요 신호'},
  {company:'BTR', event:'양산 출하', signal:'음극재 기술 상업화'}
];

const companies = {
  CATL: {
    type:'셀 · 수요처', region:'중국 + 해외', description:'양극·음극 소재 수요를 좌우하는 글로벌 배터리 셀사. 소재 페이지에서는 수요처 변화의 공통 신호로 표시.',
    snapshots:[['3년 전','글로벌 생산능력 확장과 LFP·삼원계 병행'],['1년 전','H주 상장 및 해외 시장 확대'],['현재','772GWh 생산능력·321GWh 건설 중 캐파 공개']],
    market:[['2025.05','H주 상장','해외상장 외국주식(H주) 상장 사실 공시.','customer-commercialization'],['2026.03','생산능력 공개','글로벌 생산능력 772GWh, 건설 중 321GWh 공개.','investment-production'],['2026.05','해외 협력','위통과 60개국 이상 공동 해외 확장 MOU 체결.','regional-overseas']],
    tech:[['2026.03','연구개발 투자 공개','2025년 R&D 221억 위안, 10년 누적 900억 위안 이상 공개.','technology-development'],['2026.03','재활용 실적 공개','사용후 배터리 21만 톤 재활용, 리튬염 2.4만 톤 재생 사실 공개.','technology-development']]
  },
  Ronbay: {
    type:'양극재 · 삼원계/LFP/LMFP', region:'중국 · 유럽 · 북미', description:'고니켈·중니켈·LFP·LMFP·나트륨 양극재를 병행하는 중국 양극재사.',
    snapshots:[['3년 전','고니켈·삼원계 중심 제품 구조'],['1년 전','LMFP·나트륨 양극과 유럽 생산 준비'],['현재','구이저우 LFP·전구체 증설 및 폴란드 고니켈 라인 추진']],
    market:[['2025.08','고니켈 대형 라인 가동','월 1,200~1,400톤 유효 생산능력의 고니켈 대형 라인 가동 공시.','investment-production'],['2026.04','구이저우 증설','연 52만 톤 전구체·34만 톤 양극재 건설 시작 공시.','investment-production'],['2026.04','폴란드 생산','폴란드 1기 2.5만 톤 고니켈 라인 하반기 완공·인증 예정 공시.','regional-overseas']],
    tech:[['2025.08','LMFP 고객 인증','LMFP 순수계가 해외 셀 고객 정점 인증을 받았다고 공시.','technology-development'],['2025.10','중니켈 고전압 인증','글로벌 핵심 고객의 인증 단계를 통과했다고 공시.','technology-development'],['2026.04','중니켈 규모 출하 예정','핵심 고객 심사를 통과했고 2분기 규모 출하 예상 공시.','technology-development']]
  },
  BTR: {
    type:'음극재 · 인조흑연/실리콘', region:'중국 · 아시아 · 유럽', description:'천연·인조·실리콘계 음극재를 중심으로 해외 생산기지를 늘리는 중국 소재사.',
    snapshots:[['3년 전','흑연 음극 중심의 통합 공급망'],['1년 전','실리콘계 음극 고객 공급망 진입 사실 공개'],['현재','인도네시아 가동·모로코 프로젝트와 CVD 실리콘탄소 출하 공개']],
    market:[['2025.05','국내외 고객 병행','국내·해외 시장을 동등하게 중시하고 해외 현지 공급망을 활용한다고 공시.','regional-overseas'],['2026.06','인도네시아 가동','연 8만 톤 음극재 프로젝트 가동 및 글로벌 고객 공급 사실 발표.','investment-production'],['2026.06','모로코 프로젝트','연 6만 톤 음극재·5만 톤 양극재 프로젝트 시작 발표.','regional-overseas']],
    tech:[['2025.05','실리콘계 국제표준','BTR 주도 실리콘계 음극 국제표준 발표 사실 공개.','technology-ip-standard'],['2026.04','CVD 실리콘탄소 출하','글로벌 주요 동력 고객 인정을 받아 양산 출하했다고 공시.','technology-development'],['2026.06','고체전지 소재 공개','유럽 행사에서 고니켈 양극·실리콘 음극·고체전해질 솔루션 공개.','technology-material-chemistry']]
  },
  Shanshan: {
    type:'음극재 · 인조흑연/실리콘', region:'중국 + 해외', description:'인조·천연흑연, 실리콘계, 하드카본 음극재를 보유한 중국 음극재사.',
    snapshots:[['3년 전','흑연 음극 중심 제품 구조'],['1년 전','음극재 수급 조정 구간'],['현재','ESS·수출·상용차 수요를 반영한 가동률 개선 팩트 공개']],
    market:[['2026.08','출하 산업 통계','중국 음극재 출하량 191만 톤·전년 대비 48% 증가를 공시에서 인용.','supply-performance'],['2026.08','가동률 변화','업계 가동률이 2025년 약 70%에서 80% 이상으로 올랐다고 공시에서 인용.','supply-performance'],['2026.08','수급·가격 설명','우수 생산능력의 단기 부족과 제품 가격 안정화를 설명.','supply-performance']],
    tech:[['2026.08','제품군 공개','인조·천연흑연, 실리콘계, 하드카본 제품군을 공시.','technology-material-chemistry'],['2026.08','고객 요구 변화','기술 지표·배치 일관성·공급 보장·비용 관리 요구를 언급.','technology-process-performance']]
  }
};

const companyDisplayNames = {
  CATL: '닝더스다이(CATL)',
  catl: '닝더스다이(CATL)',
  Ronbay: '룽바이(Ronbay)',
  ronbay: '룽바이(Ronbay)',
  BTR: '베이터루이(BTR)',
  btr: '베이터루이(BTR)',
  Shanshan: '산산(Shanshan)'
  ,shanshan: '산산(Shanshan)',
  byd: 'BYD',
  'hunan-yuneng': '후난위넝',
  putailai: '푸타이라이',
  'zhongke-electric': '중커전기'
};

const companySourceInfo = {
  CATL: { name: 'CATL 공식 발표', url: source.catl },
  Ronbay: { name: '거래소 공시', url: source.ronbay },
  BTR: { name: '거래소 공시', url: source.btr },
  Shanshan: { name: '거래소 공시', url: source.shanshan }
};

let currentCompany = 'Ronbay';
let currentNewsCompany = 'all';
let dailyReportFacts = null;
let approvedTop10 = [];
let approvedCompanyNews = [];
let pendingCandidates = [];
let rangeFlows = [];

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

function sectorLabel(sector){ return sector === 'anode' ? '음극재' : '양극재'; }
function renderSignals(){
  const cards = [
    ['Top 10','본문 확인 핵심 뉴스','공식 발표 또는 복수 주요 언론으로 확인'],
    ['기업 이벤트','증설·가동·인증·출하','회사 전략 변화를 만드는 확정 사실'],
    ['산업 신호','셀사·소재사 종합','수요처와 소재사의 연결 변화를 함께 확인']
  ];
  document.querySelector('#signal-strip').innerHTML = cards.map(([label,value,desc]) => `<article class="signal-card"><div class="signal-label">${label}</div><div class="signal-value">${value}</div><div class="signal-desc">${desc}</div></article>`).join('');
}
function renderDailySummary(){
  const facts = dailyReportFacts || ['전체 수집 후보 중 본문을 확인한 기사만 중요도·확정성·출처 신뢰도 기준으로 Top 10에 올린다.','소재사에서는 증설·가동·고객 인증·양산 출하 같은 실행 사실이, 셀사에서는 캐파·제품·해외 전략이 주요 변화로 확인됐다.','아래 회사별 뉴스는 Top 10 포함 여부와 별개로 해당 기업의 승인된 이벤트를 누적해 보여준다.'];
  document.querySelector('#daily-summary-list').innerHTML = facts.map(fact => `<li>${fact}</li>`).join('');
}
function renderTopNews(){
  const template = document.querySelector('#news-template');
  const target = document.querySelector('#news-feed'); target.innerHTML = '';
  if (!approvedTop10.length) {
    target.innerHTML = '<p>아직 오늘의 Daily 분석 결과가 없습니다. 상단의 수집·분석 1회 실행을 누르면 헤드라인 선별, 본문 분석, 한국어 요약을 순서대로 진행합니다.</p>';
    return;
  }
  approvedTop10.forEach((item, index) => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = `TOP ${index + 1}`; sector.classList.toggle('anode', false);
    node.querySelector('.confidence-tag').textContent = item.confidence;
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = `${companyDisplayNames[item.company] || item.company} · ${item.title}`;
    node.querySelector('.news-fact').textContent = item.fact;
    node.querySelector('.impact-reason').textContent = item.why;
    node.querySelector('a').href = item.url;
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
    node.querySelector('h3').textContent = `${companyDisplayNames[item.company] || item.company} · ${item.title}`;
    node.querySelector('.news-fact').textContent = `분류 근거: 회사 별칭 매칭 / 제목 키워드 ‘${item.classification.event}’. 원문 본문과 출처 신뢰도는 아직 검증하지 않았습니다.`;
    node.querySelector('.impact-reason').textContent = `출처: ${item.sourceName || 'RSS'}`;
    node.querySelector('a').href = item.url;
    target.append(node);
  });
}
function renderHeadlineSankey(){
  const counts = new Map();
  rangeFlows.forEach(({company_id, keyword}) => {
    const key = `${company_id}\u0000${keyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const flows = [...counts.entries()].map(([key, count]) => {
    const [company, keyword] = key.split('\u0000'); return { company, keyword, count };
  });
  const target = document.querySelector('#headline-sankey');
  if (!flows.length) {
    target.innerHTML = '<p>선택 기간에 LLM 키워드 분류를 마친 비-Top 10 기사가 없습니다.</p>';
    return;
  }
  const sourceNames = [...new Set(flows.map(flow => flow.company))];
  const keywordNames = [...new Set(flows.map(flow => flow.keyword))];
  const height = Math.max(310, Math.max(sourceNames.length, keywordNames.length) * 54 + 54);
  const yFor = (names, name, top, gap) => top + names.indexOf(name) * gap;
  const label = name => companyDisplayNames[name] || name;
  const curve = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 130} ${y1}, ${x2 - 130} ${y2}, ${x2} ${y2}`;
  const links = flows.map(flow => {
    const sy = yFor(sourceNames, flow.company, 48, 54) + 12;
    const ky = yFor(keywordNames, flow.keyword, 48, 54) + 12;
    return `<path d="${curve(164, sy, 600, ky)}" fill="none" stroke="#4f8d70" stroke-width="${Math.min(28, 5 + flow.count * 4)}" stroke-opacity=".55"/>`;
  }).join('');
  const nodes = (names, x, top, gap, fill, formatter = value => value) => names.map(name => {
    const y = yFor(names, name, top, gap);
    return `<g><rect x="${x}" y="${y}" width="190" height="24" rx="4" fill="${fill}"/><text x="${x + 8}" y="${y + 16}" fill="#14263d" font-size="11" font-weight="700">${formatter(name)}</text></g>`;
  }).join('');
  const keywordLabel = keyword => `${keyword} · ${flows.filter(flow => flow.keyword === keyword).reduce((sum, flow) => sum + flow.count, 0)}건`;
  target.innerHTML = `<svg viewBox="0 0 820 ${height}" role="img" aria-label="기업별 핵심 키워드 기사 건수 흐름도" style="display:block;width:100%;height:auto;min-height:310px"><text x="14" y="20" fill="#617187" font-size="11" font-weight="700">기업</text><text x="600" y="20" fill="#617187" font-size="11" font-weight="700">핵심 키워드 · 기사 수</text>${links}${nodes(sourceNames, 14, 48, 54, '#eaf3fb', label)}${nodes(keywordNames, 600, 48, 54, '#e3f5ed', keywordLabel)}</svg>`;
}
function renderCompanyNews(){
  const companiesInNews = ['all', ...new Set(approvedCompanyNews.map(item => item.company))];
  document.querySelector('#company-news-controls').innerHTML = companiesInNews.map(company => `<button class="segment ${company === currentNewsCompany ? 'is-selected' : ''}" data-news-company="${company}">${company === 'all' ? '전체 회사' : companyDisplayNames[company] || company}</button>`).join('');
  const template = document.querySelector('#news-template');
  const target = document.querySelector('#company-news-feed'); target.innerHTML = '';
  const filtered = approvedCompanyNews.filter(item => currentNewsCompany === 'all' || item.company === currentNewsCompany);
  if (!filtered.length) target.innerHTML = '<p>본문 검증과 승인까지 마친 회사별 뉴스가 아직 없습니다.</p>';
  filtered.forEach(item => {
    const node = template.content.cloneNode(true);
    const sector = node.querySelector('.sector-tag'); sector.textContent = companyDisplayNames[item.company] || item.company; sector.classList.toggle('anode', false);
    node.querySelector('.confidence-tag').textContent = item.confidence;
    node.querySelector('time').textContent = item.date;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.news-fact').textContent = item.fact;
    node.querySelector('.impact-reason').textContent = item.why;
    node.querySelector('a').href = item.url;
    target.append(node);
  });
  document.querySelectorAll('[data-news-company]').forEach(button => button.addEventListener('click', () => { currentNewsCompany = button.dataset.newsCompany; renderCompanyNews(); }));
}
function mapDashboardArticle(article){
  const relation = article.article_company?.[0];
  return {
    sector: 'all',
    company: relation?.company_id || '기타',
    date: article.published_at ? article.published_at.slice(0, 10).replaceAll('-', '.') : '날짜 미상',
    title: article.title_ko || article.title_original,
    fact: article.summary_ko || '한국어 팩트 요약 검수 대기',
    why: article.is_top10 ? '헤드라인 선별 후 본문 정독·팩트 요약 완료' : article.verification_status === 'pending' ? '미분석 수집 원문' : '분석된 회사 이벤트',
    confidence: article.verification_status === 'pending_review' ? 'LLM 본문 분류 완료' : article.verification_status === 'pending' ? '미분석' : article.source_tier || '검수 완료',
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
    news = [...approvedTop10, ...approvedCompanyNews];
    if (payload.report?.summary_ko) {
      dailyReportFacts = payload.report.summary_ko.split(/\n+/).filter(Boolean);
    }
    renderSignals(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews();
  } catch {
    // 환경변수 미설정·DB 초기화 전에는 시드 화면을 유지한다.
  }
}
function makeSelect(select, selected){
  select.innerHTML = Object.keys(companies).map(name => `<option value="${name}" ${name === selected ? 'selected' : ''}>${companyDisplayNames[name]} · ${companies[name].type}</option>`).join('');
}
function renderCompany(){
  const company = companies[currentCompany];
  document.querySelector('#company-profile').innerHTML = `<div><p class="eyebrow" style="color:#b6dcff">${company.type}</p><h2>${companyDisplayNames[currentCompany]}</h2><p>${company.description}</p></div><div class="company-badges"><span class="company-badge">${company.region}</span><span class="company-badge">팩트 기반</span></div>`;
  const majorEvents = [
    ...company.market.map(([date, title, fact, layer]) => ({date, title, fact, track: 'market', label: marketLayerLabels[layer], layer})),
    ...company.tech.map(([date, title, fact, layer]) => ({date, title, fact, track: 'tech', label: technologyLayerLabels[layer], layer}))
  ].sort((a, b) => a.date.localeCompare(b.date));
  document.querySelector('#snapshot-grid').innerHTML = majorEvents.map(event => `<article class="snapshot ${event.track}"><span class="snapshot-year">${event.date} · ${event.label}</span><h3>${event.title}</h3><ul><li>${event.fact}</li></ul></article>`).join('');
  renderLayerMatrix(company);
}
function renderLayerMatrix(company){
  const years = ['2023', '2024', '2025', '2026'];
  const layers = [
    ['시장', '수급·실적', 'supply-performance'], ['시장', '투자·생산기반', 'investment-production'], ['시장', '고객·상업화', 'customer-commercialization'], ['시장', '지역·해외전략', 'regional-overseas'],
    ['기술', '소재·화학계', 'technology-material-chemistry'], ['기술', '공정·성능', 'technology-process-performance'], ['기술', 'IP·표준', 'technology-ip-standard'], ['기술', '개발·인증·양산', 'technology-development']
  ];
  const events = [
    ...company.market.map(([date, title, fact, layer]) => ({date, title, fact, layer})),
    ...company.tech.map(([date, title, fact, layer]) => ({date, title, fact, layer}))
  ];
  const cells = (layer, year) => events.filter(event => event.layer === layer && event.date.startsWith(year)).map(event => `<div style="margin-bottom:8px"><strong>${event.title}</strong><br><span style="color:#526277">${event.fact}</span></div>`).join('') || '<span style="color:#9aa7b6">—</span>';
  document.querySelector('#dual-track').innerHTML = `<div style="overflow-x:auto"><table style="width:100%;min-width:920px;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:10px;border-bottom:1px solid #dbe3ec">구분</th><th style="text-align:left;padding:10px;border-bottom:1px solid #dbe3ec">레이어</th>${years.map(year => `<th style="text-align:left;padding:10px;border-bottom:1px solid #dbe3ec">${year}</th>`).join('')}</tr></thead><tbody>${layers.map(([group, label, layer]) => `<tr><td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700;color:${group === '시장' ? '#236aa6' : '#8b5a10'}">${group}</td><td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;font-weight:700">${label}</td>${years.map(year => `<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #edf1f4;min-width:170px">${cells(layer, year)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function exportCompanyTimeline(){
  const company = companies[currentCompany];
  const sourceInfo = companySourceInfo[currentCompany] || { name: '출처 검수 대기', url: '' };
  const rows = [['회사', '구분', '레이어', '시기', '발생일', '주요 사실', '상세', '출처', '출처 링크', '원문 발췌', '원문 한국어 번역']];
  const addRow = (group, label, date, title, fact) => rows.push([companyDisplayNames[currentCompany], group, label, date.slice(0, 4), date, title, fact, sourceInfo.name, sourceInfo.url, '시드 데이터: 원문 발췌 미적재', '시드 데이터: 한국어 번역 미적재']);
  company.market.forEach(([date, title, fact, layer]) => addRow('시장', marketLayerLabels[layer], date, title, fact));
  company.tech.forEach(([date, title, fact, layer]) => addRow('기술', technologyLayerLabels[layer], date, title, fact));
  if (window.XLSX) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{wch:20}, {wch:10}, {wch:20}, {wch:10}, {wch:12}, {wch:28}, {wch:70}, {wch:18}, {wch:55}, {wch:55}, {wch:55}];
    rows.slice(1).forEach((row, index) => { sheet[`I${index + 2}`].l = { Target: row[8] }; });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기업 시계열');
    XLSX.writeFile(workbook, `${currentCompany}_timeline.xlsx`);
    return;
  }
  const escapeCell = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const table = rows.map((row, index) => `<tr>${row.map(value => `<${index ? 'td' : 'th'}>${escapeCell(value)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('');
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
function comparisonTimeline(company){
  const item = companies[company];
  return [...item.market, ...item.tech].map(([date, title, fact]) => ({date, title, fact}));
}
function renderComparison(){
  const a = document.querySelector('#compare-a').value;
  const b = document.querySelector('#compare-b').value;
  const eventsA = comparisonTimeline(a);
  const eventsB = comparisonTimeline(b);
  const dates = [...new Set([...eventsA, ...eventsB].map(event => event.date))].sort().reverse();
  const eventsAt = (events, date) => events.filter(event => event.date === date).map(event => `<div style="margin-bottom:7px"><strong>${event.title}</strong><br><span style="color:#526277;font-size:12px">${event.fact}</span></div>`).join('');
  const eventCell = (events, date, side) => `<div style="min-height:54px;padding:10px 12px;background:${eventsAt(events, date) ? '#ffffff' : 'transparent'};border:${eventsAt(events, date) ? '1px solid #dbe3ec' : '0'};border-radius:8px;text-align:${side};font-size:13px">${eventsAt(events, date) || '<span style="color:#9aa7b6">—</span>'}</div>`;
  document.querySelector('#comparison-grid').innerHTML = `<section class="compare-card" style="padding:22px;overflow-x:auto"><div style="min-width:900px"><div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:end;margin-bottom:14px"><div><p class="eyebrow">기업 A</p><h2>${companyDisplayNames[a]}</h2></div><div style="text-align:center;color:#617187;font-size:12px">공통 시간축<br>↑ 최근</div><div style="text-align:right"><p class="eyebrow">기업 B</p><h2>${companyDisplayNames[b]}</h2></div></div><div style="position:relative">${dates.map((date, index) => `<div style="display:grid;grid-template-columns:1fr 130px 1fr;gap:24px;align-items:center;min-height:104px"><div>${eventCell(eventsA, date, 'left')}</div><div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">${index < dates.length - 1 ? '<span style="position:absolute;top:50%;bottom:-52px;border-left:2px solid #b8c9d9"></span>' : ''}<span style="position:relative;width:14px;height:14px;border-radius:50%;background:#10365f;border:3px solid #eaf3fb"></span><time style="position:relative;margin-top:5px;color:#617187;font-size:12px;font-weight:700">${date}</time></div><div>${eventCell(eventsB, date, 'right')}</div></div>`).join('')}</div><p style="margin:8px 0 0;text-align:center;color:#617187;font-size:12px">과거 ↓</p></div></section>`;
}
function activateView(view){
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('is-visible', el.id === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('is-active',el.dataset.view===view));
}
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => activateView(link.dataset.view)));
document.querySelector('#refresh-button').addEventListener('click', () => { renderSignals(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews(); loadDashboardFromApi(); });
document.querySelector('#sankey-range-apply').addEventListener('click', loadDashboardFromApi);
document.querySelector('#run-collection-button').addEventListener('click', async () => {
  const button = document.querySelector('#run-collection-button');
  button.disabled = true; button.textContent = '수집·분석 중…';
  try {
    const result = await fetch('/api/ingest-rss?process=1', { method: 'POST' });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.status || '요청 실패');
    window.alert(`Daily 분석 완료: 발견 ${payload.discovered}건 / 저장 ${payload.stored}건 / 헤드라인 Top ${payload.headline_selected || 0}건 / 본문 처리 ${payload.llm_processed || 0}건\n첫 화면을 최신 결과로 갱신합니다.`);
    await loadDashboardFromApi();
  } catch (error) {
    window.alert(`수집을 실행하지 못했습니다: ${error.message}`);
  } finally {
    button.disabled = false; button.textContent = '수집·분석 1회 실행';
  }
});
const select = document.querySelector('#company-select'); makeSelect(select,currentCompany); select.addEventListener('change', () => { currentCompany = select.value; renderCompany(); });
document.querySelector('#export-company-timeline').addEventListener('click', exportCompanyTimeline);
document.querySelector('#export-raw-news').addEventListener('click', exportRawNews);
const compareA=document.querySelector('#compare-a'),compareB=document.querySelector('#compare-b'); makeSelect(compareA,'Ronbay'); makeSelect(compareB,'BTR'); compareA.addEventListener('change',renderComparison); compareB.addEventListener('change',renderComparison);
const sankeyTo = new Date();
const sankeyFrom = new Date(); sankeyFrom.setDate(sankeyFrom.getDate() - 30);
document.querySelector('#sankey-from').value = sankeyFrom.toISOString().slice(0, 10);
document.querySelector('#sankey-to').value = sankeyTo.toISOString().slice(0, 10);
renderSignals(); renderDailySummary(); renderTopNews(); renderHeadlineSankey(); renderCompanyNews(); renderCompany(); renderComparison();
loadDashboardFromApi();

async function initializeAccessGate(){
  const gate = document.querySelector('#access-gate');
  const shell = document.querySelector('#app-shell');
  const form = document.querySelector('#access-form');
  const message = document.querySelector('#access-message');
  try {
    const result = await fetch('/api/access', { cache: 'no-store' });
    if (result.ok) { shell.hidden = false; return; }
  } catch {}
  gate.hidden = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true; message.textContent = '';
    try {
      const result = await fetch('/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKey: document.querySelector('#access-key').value }) });
      if (!result.ok) throw new Error('invalid_access_key');
      window.location.reload();
    } catch {
      message.textContent = '접근 키가 올바르지 않거나 아직 설정되지 않았습니다.';
      button.disabled = false;
    }
  });
}
initializeAccessGate();
