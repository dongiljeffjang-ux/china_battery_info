// 관리자 페이지. /api/admin?view=... 를 읽어 파이프라인 중간 산출물을 그대로 그린다.
// 쓰기는 'RAG 평가' 화면의 판정 저장 하나뿐이며 rag_evaluation 테이블에만 쓴다.
(function () {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = (value) => value ? String(value).replace('T', ' ').slice(0, 16) : '—';
  const fmtDay = (value) => value ? String(value).slice(0, 10) : '—';
  const num = (value) => Number(value || 0).toLocaleString('ko-KR');
  const companies = new Map();
  let auditIssues = [];

  function viaTag(via) {
    if (!via) return '<span class="tag none">미기록</span>';
    const cls = via.includes('openai') && via.includes('deepseek') ? 'both' : via.includes('deepseek') ? 'deepseek' : via.includes('openai') ? 'openai' : via;
    const label = { web_search_openai: 'OpenAI', web_search_deepseek: 'DeepSeek', 'web_search_deepseek+openai': 'OpenAI+DeepSeek', cninfo: 'CNINFO', catl_newsroom: 'CATL', google_news_rss: 'RSS(구)', web_search_discovered: '검색(제공자 미상)' }[via] || via;
    return `<span class="tag ${esc(cls)}">${esc(label)}</span>`;
  }

  // ---------- 데이터 감사 ----------
  const auditKindLabel = (kind) => ({
    company_subject_mismatch: '다른 회사명 발견', company_not_mentioned: '연결 회사명 없음', article_without_company: '기사 회사 미연결',
    chunk_company_mismatch: '청크 회사 불일치', chunk_orphan_article: '청크 기사 누락', event_company_mismatch: '이벤트 회사 불일치', event_orphan_article: '이벤트 기사 누락',
  })[kind] || kind;

  function filteredAuditIssues() {
    const severity = $('#audit-severity').value;
    const kind = $('#audit-kind').value;
    const company = $('#audit-company').value;
    const q = $('#audit-q').value.trim().toLowerCase();
    return auditIssues.filter((issue) => (!severity || issue.severity === severity)
      && (!kind || issue.kind === kind)
      && (!company || (issue.linked_company_ids || []).includes(company) || issue.record_company_id === company || (issue.detected_company_ids || []).includes(company))
      && (!q || [issue.title, issue.source_name, issue.reason].some((value) => String(value || '').toLowerCase().includes(q))));
  }

  function renderAudit() {
    const rows = filteredAuditIssues();
    $('#audit-count').textContent = `${rows.length}건 / 전체 후보 ${auditIssues.length}건`;
    table($('#audit-table'), ['우선도', '문제 유형', '발행일·매체', '기사', '검사 대상 회사', '본문에서 찾은 회사', '판정 이유', '영향 행'], rows.map((issue) => `<tr>
      <td>${issue.severity === 'high' ? '<span class="tag audit-high">높음</span>' : '<span class="tag audit-review">확인 필요</span>'}</td>
      <td>${esc(auditKindLabel(issue.kind))}</td><td class="small">${fmtDay(issue.published_at)}<br>${esc(issue.source_name || '—')}</td>
      <td>${issue.article_id ? `<a class="link" data-article="${esc(issue.article_id)}">${esc(issue.title)}</a>` : esc(issue.title)}${issue.source_url ? `<div><a class="link small" href="${esc(issue.source_url)}" target="_blank" rel="noopener">원문 열기</a></div>` : ''}</td>
      <td class="small">${esc(issue.record_company_id ? companyName(issue.record_company_id) : (issue.linked_company_ids || []).map(companyName).join(', ') || '—')}${issue.record_company_id && (issue.linked_company_ids || []).length > 1 ? `<div class="muted">전체 연결: ${esc(issue.linked_company_ids.map(companyName).join(', '))}</div>` : ''}</td>
      <td class="small">${esc((issue.detected_company_ids || []).map(companyName).join(', ') || '—')}</td><td class="small">${esc(issue.reason)}</td><td class="num">${num(issue.affected_count)}</td></tr>`));
  }

  async function loadAudit() {
    $('#audit-count').textContent = '전체 데이터를 검사하는 중…';
    const { audit } = await api({ view: 'audit' });
    auditIssues = audit.issues || [];
    const card = (label, value, sub = '', warn = false) => `<div class="stat${warn ? ' warn' : ''}"><p class="label">${esc(label)}</p><div class="value">${num(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    $('#audit-cards').innerHTML = [
      card('검사 기사', audit.scanned.articles, `이벤트 ${num(audit.scanned.events)} · 청크 ${num(audit.scanned.chunks)}`),
      card('높은 우선도', audit.counts.high, '다른 회사명 또는 관계 불일치', audit.counts.high > 0),
      card('확인 필요', audit.counts.review, '회사명이 없어 원문 판단 필요'),
      card('전체 후보', audit.counts.total, `검사 ${fmtDate(audit.generated_at)} UTC`),
    ].join('');
    const kinds = [...new Set(auditIssues.map((issue) => issue.kind))].sort();
    $('#audit-kind').innerHTML = `<option value="">전체</option>${kinds.map((kind) => `<option value="${esc(kind)}">${esc(auditKindLabel(kind))}</option>`).join('')}`;
    renderAudit();
  }

  function exportAudit() {
    const header = ['우선도', '문제 유형', '발행일', '매체', '제목', '검사 대상 회사', '본문에서 찾은 회사', '판정 이유', '영향 행', '원문 URL'];
    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredAuditIssues().map((issue) => [issue.severity === 'high' ? '높음' : '확인 필요', auditKindLabel(issue.kind), fmtDay(issue.published_at), issue.source_name, issue.title, issue.record_company_id ? companyName(issue.record_company_id) : (issue.linked_company_ids || []).map(companyName).join(', '), (issue.detected_company_ids || []).map(companyName).join(', '), issue.reason, issue.affected_count, issue.source_url].map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...rows].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `china-battery-data-audit-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  const tag = (value) => value ? `<span class="tag ${esc(value)}">${esc(value)}</span>` : '<span class="tag none">—</span>';
  const companyName = (id) => companies.get(id) || id || '—';

  async function api(params) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const result = await fetch(`/api/admin?${query}`, { cache: 'no-store' });
    if (result.status === 401) { location.reload(); throw new Error('access_required'); }
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(`${payload.status || result.status}${payload.message ? ` · ${payload.message}` : ''}`);
    return payload;
  }
  async function postApi(view, body) {
    const result = await fetch(`/api/admin?view=${encodeURIComponent(view)}`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result.status === 401) { location.reload(); throw new Error('access_required'); }
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(payload.message || payload.status || `HTTP ${result.status}`);
    return payload;
  }
  function showError(error) { const box = $('#admin-error'); box.hidden = !error; box.textContent = error ? `조회 실패: ${error.message || error}` : ''; }
  function table(el, headers, rows) {
    el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="muted">없음</td></tr>`}</tbody>`;
  }

  // ---------- 개요 ----------
  async function loadOverview() {
    const { overview, last_runs } = await api({ view: 'overview' });
    const byStatus = overview.articles_by_status || [];
    const total = byStatus.reduce((s, r) => s + r.count, 0);
    const verified = byStatus.filter((r) => ['verified', 'pending_review', 'approved'].includes(r.verification_status)).reduce((s, r) => s + r.count, 0);
    const untried = byStatus.filter((r) => r.verification_status === 'pending' && !r.processing_status).reduce((s, r) => s + r.count, 0);
    const failed = byStatus.filter((r) => ['body_unavailable', 'body_too_short', 'processing_failed'].includes(r.processing_status)).reduce((s, r) => s + r.count, 0);
    const rejected = byStatus.filter((r) => r.processing_status === 'fact_check_rejected').reduce((s, r) => s + r.count, 0);
    const openai = byStatus.filter((r) => (r.discovered_via || '').includes('openai')).reduce((s, r) => s + r.count, 0);
    const deepseek = byStatus.filter((r) => (r.discovered_via || '').includes('deepseek')).reduce((s, r) => s + r.count, 0);
    const cninfo = byStatus.filter((r) => r.discovered_via === 'cninfo').reduce((s, r) => s + r.count, 0);
    const chunkTotal = (overview.chunks_by_type || []).reduce((s, r) => s + r.count, 0);
    const chunkNoVec = (overview.chunks_by_type || []).reduce((s, r) => s + (r.count - r.with_vector), 0);
    const ev = overview.events || {};
    const embFailed = (overview.article_embedding || []).find((r) => r.embedding_status === 'failed')?.count || 0;
    const card = (label, value, sub = '', warn = false) => `<div class="stat${warn ? ' warn' : ''}"><p class="label">${esc(label)}</p><div class="value">${num(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    $('#overview-cards').innerHTML = [
      card('수집 기사', total, `검증 통과 ${num(verified)}`),
      card('OpenAI 검색 발견', openai, '누적 · 두 곳 모두 찾은 건 포함'),
      card('DeepSeek 검색 발견', deepseek, deepseek ? '' : '한 건도 없음 → 검색 실패 확인 필요', !deepseek),
      card('CNINFO 공시', cninfo),
      card('본문 처리 미시도', untried, '최근 3일 창 밖은 흘려보냄'),
      card('본문 처리 실패', failed, 'URL·PDF·길이 문제', failed > 0),
      card('교차검증 탈락', rejected),
      card('검증 기사 중 청크 없음', overview.verified_without_chunks, '', overview.verified_without_chunks > 0),
      card('기사 임베딩 실패', embFailed, '', embFailed > 0),
      card('벡터 청크', chunkTotal, chunkNoVec ? `벡터 없는 청크 ${num(chunkNoVec)}` : '모두 벡터 있음', chunkNoVec > 0),
      card('이벤트', ev.total, `레이어 미분류 ${num(ev.layer_null)} · 시점 근거 없음 ${num(ev.basis_null)}`),
      card('벡터 없는 이벤트', ev.no_vector, '', ev.no_vector > 0),
      card('헤드라인 임베딩', overview.headline_embedded, `대기 ${num(overview.headline_pending)}`),
      card('Daily 리포트', overview.daily_reports, `읽은 보고서 ${num(overview.report_digest)}`),
    ].join('');
    $('#admin-asof').textContent = `집계 ${fmtDate(overview.generated_at)} UTC · 읽기 전용`;

    table($('#overview-status'), ['검증 상태', '처리 결과', '발견 경로', '건수'], byStatus.map((r) => `<tr><td>${tag(r.verification_status)}</td><td>${tag(r.processing_status || 'none')}</td><td>${viaTag(r.discovered_via)}</td><td class="num">${num(r.count)}</td></tr>`));
    const days = new Map();
    for (const r of overview.articles_by_day || []) { if (!days.has(r.day)) days.set(r.day, {}); days.get(r.day)[r.discovered_via || '미기록'] = r.count; }
    table($('#overview-days'), ['수집일(KST)', '경로별 건수'], [...days.entries()].map(([d, m]) => `<tr><td>${esc(d)}</td><td>${Object.entries(m).map(([k, v]) => `${viaTag(k === '미기록' ? null : k)} ${num(v)}`).join(' &nbsp; ')}</td></tr>`));
    table($('#overview-chunks'), ['종류', '모델', '청크', '벡터 있음', '기사 수', '이벤트 수'], (overview.chunks_by_type || []).map((r) => `<tr><td>${tag(r.source_type)}</td><td class="small">${esc(r.embedding_model || '—')}</td><td class="num">${num(r.count)}</td><td class="num">${num(r.with_vector)}</td><td class="num">${num(r.articles)}</td><td class="num">${num(r.events)}</td></tr>`));
    table($('#overview-runs'), ['시각(UTC)', '단계', '훅', '상태', '소요'], (last_runs || []).map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td>${tag(r.stage)}</td><td class="num">${r.hop ?? '—'}</td><td>${tag(r.status)}</td><td class="num">${r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td></tr>`));
  }

  // ---------- 실행 이력 ----------
  function runSummary(run) {
    const p = run.payload || {};
    const kv = (label, value) => value == null ? '' : `<div class="kv">${esc(label)}<b>${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</b></div>`;
    if (run.stage === 'collect') {
      return `<div class="run-grid">${kv('원시 발견', Object.entries(p.raw || {}).map(([k, v]) => `${k.replace('web_search_', '')} ${v}`).join(' · ') || '—')}${kv('중복 제거 후', p.unique)}${kv('회사 매칭', p.matched)}${kv('매칭 안 됨', p.unmatched)}${kv('신규 저장', p.new_articles)}${kv('이미 있음', p.existing)}${kv('검색 실패', (p.failed || []).length)}</div>`
        + (p.web_search?.length ? `<h3 class="sub">검색 호출별 결과</h3><div class="tbl-wrap"><table class="admin"><thead><tr><th>제공자</th><th>그룹</th><th>기사</th><th>실패 사유</th></tr></thead><tbody>${p.web_search.map((w) => `<tr><td>${viaTag(`web_search_${w.provider}`)}</td><td>${esc(w.group)}</td><td class="num">${w.articles}</td><td class="small" style="${w.error ? 'color:#9b1c1c' : ''}">${esc(w.error || '')}</td></tr>`).join('')}</tbody></table></div>` : '')
        + (p.failed?.length ? `<div class="error">${p.failed.map((f) => `${esc(f.source)}: ${esc(f.message)}`).join('<br>')}</div>` : '')
        + (p.new_titles?.length ? `<div class="tbl-wrap"><table class="admin"><thead><tr><th>경로</th><th>매체</th><th>신규 기사 제목</th></tr></thead><tbody>${p.new_titles.map((t) => `<tr><td>${viaTag(t.via)}</td><td>${esc(t.source)}</td><td><a class="link" data-article="${esc(t.id)}">${esc(t.title)}</a></td></tr>`).join('')}</tbody></table></div>` : '')
        + (p.unmatched_sample?.length ? `<h3 class="sub">회사 매칭 안 된 후보(표본)</h3><div class="tbl-wrap"><table class="admin"><tbody>${p.unmatched_sample.map((t) => `<tr><td>${viaTag(t.via)}</td><td>${esc(t.source)}</td><td>${esc(t.title)}</td></tr>`).join('')}</tbody></table></div>` : '');
    }
    if (run.stage === 'process') {
      return `<div class="run-grid">${kv('선별', (p.selected || []).length)}${kv('결과', p.counts)}${kv('남음', p.leftover)}${kv('더 있음', p.more)}</div>`
        + `<div class="tbl-wrap"><table class="admin"><thead><tr><th>기사</th><th>매체</th><th>점수</th><th>결과</th><th>사유</th><th>청크</th></tr></thead><tbody>${(p.selected || []).map((s) => { const o = (p.outcomes || []).find((x) => x.articleId === s.id) || {}; return `<tr><td><a class="link" data-article="${esc(s.id)}">${esc(s.title)}</a></td><td class="small">${esc(s.source)}</td><td class="num">${s.score}</td><td>${tag(o.status || '미시도')}${o.duplicate ? ' <span class="tag">이벤트 중복</span>' : ''}</td><td class="small">${esc(o.reason || '')}</td><td class="num">${o.chunks ?? '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
    }
    return `<pre class="json">${esc(JSON.stringify(p, null, 2))}</pre>`;
  }
  async function loadRuns() {
    const { runs } = await api({ view: 'runs', stage: $('#runs-stage').value });
    $('#runs-list').innerHTML = runs.length ? runs.map((run) => `<details class="run"><summary>${fmtDate(run.created_at)} <span>${tag(run.stage)}</span> ${run.hop ? `<span class="muted">훅 ${run.hop}</span>` : ''} ${tag(run.status)} <span class="muted">${run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : ''}</span></summary>${runSummary(run)}</details>`).join('')
      : '<p class="notice">아직 기록이 없습니다. SQL 적용 후 첫 수집부터 쌓입니다.</p>';
  }

  // ---------- 수집 기사 ----------
  async function loadArticles() {
    const params = { view: 'articles', via: $('#art-via').value, verification: $('#art-verification').value, processing: $('#art-processing').value, embedding: $('#art-embedding').value, company: $('#art-company').value, dateField: $('#art-datefield').value, from: $('#art-from').value, to: $('#art-to').value, q: $('#art-q').value };
    const { articles, limit } = await api(params);
    $('#art-count').textContent = `${articles.length}건${articles.length >= limit ? ` (최대 ${limit}건, 조건을 좁히세요)` : ''}`;
    table($('#art-table'), ['수집일', '발행일', '경로', '매체', '제목', '회사', '검증', '처리 결과', '임베딩', '청크', 'Top10'], articles.map((a) => `<tr>
      <td class="small">${fmtDay(a.created_at)}</td><td class="small">${fmtDay(a.published_at)}</td><td>${viaTag(a.discovered_via)}</td><td class="small">${esc(a.source_name)}</td>
      <td><a class="link" data-article="${esc(a.id)}">${esc(a.title_ko || a.title_original)}</a>${a.title_ko ? `<div class="muted small clip">${esc(a.title_original)}</div>` : ''}${a.processing_note ? `<div class="small" style="color:#9b1c1c">${esc(a.processing_note.slice(0, 160))}</div>` : ''}</td>
      <td class="small">${(a.companies || []).map(companyName).join(', ')}</td><td>${tag(a.verification_status)}</td><td>${tag(a.processing_status || 'none')}</td><td>${a.body_fetched_at ? tag(a.embedding_status) : '<span class="muted small">본문 없음</span>'}${a.headline_embedded_at ? ' <span class="tag">헤드라인</span>' : ''}</td><td class="num">${a.chunk_count}</td><td class="num">${a.is_top10 ? a.top10_rank : ''}</td></tr>`));
  }

  // ---------- 기사 상세 ----------
  async function openArticle(id) {
    const drawer = $('#drawer');
    drawer.hidden = false;
    drawer.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      const { article: a, chunks, events, feedback, rechunk_preview } = await api({ view: 'article', id });
      const kv = (label, value) => `<div class="kv">${esc(label)}<b>${value}</b></div>`;
      drawer.innerHTML = `<button class="secondary-button close" type="button" data-close>닫기</button>
        <p class="eyebrow">ARTICLE</p><h2>${esc(a.title_ko || a.title_original)}</h2>
        <p class="muted small">${esc(a.title_original)}</p>
        <p class="small">${viaTag(a.discovered_via)} ${tag(a.source_tier)} ${tag(a.verification_status)} ${tag(a.processing_status || 'none')} · ${esc(a.source_name)} · 발행 ${fmtDay(a.published_at)} · 수집 ${fmtDate(a.created_at)} · <a class="link" href="${esc(a.canonical_url)}" target="_blank" rel="noopener">원문 열기</a></p>
        <div class="run-grid">${kv('회사', esc((a.companies || []).map((c) => c.name_ko || c.id).join(', ') || '—'))}${kv('본문 길이', num(a.body_length))}${kv('본문 수집', fmtDate(a.body_fetched_at))}${kv('임베딩', `${esc(a.embedding_status)} ${a.embedded_at ? fmtDate(a.embedded_at) : ''}`)}${kv('저장 청크', chunks.filter((c) => c.source_type === 'article_chunk').length)}${kv('지금 규칙으로 재청킹', `${rechunk_preview.count}조각`)}${kv('피드백', feedback.map((f) => f.vote > 0 ? '👍' : '👎').join(' ') || '—')}</div>
        ${a.processing_note ? `<div class="error">처리 사유: ${esc(a.processing_note)}</div>` : ''}
        ${a.summary_ko ? `<h3 class="sub">한국어 요약(검증자 산출)</h3><p>${esc(a.summary_ko)}</p><p class="small muted">키워드: ${esc((a.keywords_ko || []).join(', '))}</p>` : ''}
        ${a.headline_signals ? `<h3 class="sub">헤드라인 신호</h3><pre class="json">${esc(JSON.stringify(a.headline_signals))}</pre>` : ''}
        <h3 class="sub">이벤트 (${events.length})</h3>
        ${events.length ? events.map((e) => `<div class="chunk"><header>${fmtDay(e.occurred_at)} ${tag(e.occurred_precision)} ${tag(e.evidence_kind)} ${tag(e.timeline_eligibility)} ${tag(e.trajectory_track)} ${e.layer_key ? tag(e.layer_key) : '<span class="tag failed">레이어 미분류</span>'} ${e.entity_names?.length ? `<span class="tag">${esc(e.entity_names.join(', '))}</span>` : ''}</header><b>${esc(e.title_ko)}</b><p style="margin:4px 0">${esc(e.fact_ko)}</p>${e.original_excerpt ? `<details><summary class="small muted">원문 발췌</summary><pre>${esc(e.original_excerpt)}\n\n${esc(e.original_excerpt_ko || '')}</pre></details>` : ''}${e.occurred_basis ? `<p class="small muted">시점 근거: ${esc(e.occurred_basis)}</p>` : ''}</div>`).join('') : '<p class="muted small">이벤트 없음</p>'}
        <h3 class="sub">청크 (${chunks.length})</h3>
        ${a.body_length ? `<p class="small muted">청킹 규칙: 공백 정규화 후 1,800자 단위, 180자 중첩, 문장 경계(줄바꿈·。·. ) 우선, 최대 24조각. 재청킹 조각 길이: ${esc(rechunk_preview.lengths.join(', ') || '—')}</p>` : ''}
        ${chunks.length ? chunks.map((c) => `<div class="chunk"><header>${tag(c.source_type)} ${c.chunk_index != null ? `${c.chunk_index + 1}/${c.chunk_total}` : ''} · ${c.has_vector ? '<span class="tag embedded">벡터 있음</span>' : '<span class="tag failed">벡터 없음</span>'} · ${esc(c.embedding_model || '')} · ${fmtDate(c.created_at)}</header><div class="two"><div><div class="small muted">임베딩 입력(content_ko)</div><pre>${esc(c.content_ko)}</pre></div>${c.content_original ? `<div><div class="small muted">원문 조각(content_original) · ${num(c.content_original.length)}자</div><pre>${esc(c.content_original)}</pre></div>` : ''}</div></div>`).join('') : '<p class="muted small">청크 없음</p>'}
        ${a.body_length ? `<h3 class="sub">본문 앞부분</h3><pre class="json" style="background:#f8fafc;color:var(--ink);white-space:pre-wrap">${esc(a.body_head)}</pre>` : ''}`;
    } catch (error) {
      drawer.innerHTML = `<button class="secondary-button close" type="button" data-close>닫기</button><div class="error">${esc(error.message)}</div>`;
    }
  }

  // ---------- 이벤트 ----------
  async function loadEvents() {
    const { events, limit } = await api({ view: 'events', company: $('#ev-company').value, evidence: $('#ev-evidence').value, missing: $('#ev-missing').value, from: $('#ev-from').value, to: $('#ev-to').value, q: $('#ev-q').value });
    $('#ev-count').textContent = `${events.length}건${events.length >= limit ? ` (최대 ${limit}건)` : ''}`;
    table($('#ev-table'), ['시점', '회사', '제목 · 사실', '트랙 · 레이어', '근거', '등급', '시점 근거', '벡터', '출처'], events.map((e) => `<tr>
      <td class="small">${fmtDay(e.occurred_at)}<br>${tag(e.occurred_precision)}</td><td class="small">${esc(companyName(e.company_id))}${e.entity_names?.length ? `<div class="muted">${esc(e.entity_names.join(', '))}</div>` : ''}</td>
      <td><b>${esc(e.title_ko)}</b><div class="small">${esc(e.fact_ko)}</div></td><td>${tag(e.trajectory_track)} ${e.layer_key ? tag(e.layer_key) : '<span class="tag failed">미분류</span>'}</td><td>${tag(e.evidence_kind)}</td><td>${tag(e.timeline_eligibility)}</td>
      <td class="small">${e.occurred_basis ? esc(e.occurred_basis.slice(0, 80)) : '<span class="tag failed">없음</span>'}</td><td class="num">${e.chunk_count ? `<span class="tag embedded">${e.chunk_count}</span>` : '<span class="tag failed">0</span>'}</td>
      <td class="small">${e.article_id ? `<a class="link" data-article="${esc(e.article_id)}">기사</a> · ` : ''}${e.source_url ? `<a class="link" href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(e.source_name || '원문')}</a>` : esc(e.source_name || '')}</td></tr>`));
  }

  // ---------- 청크 ----------
  async function loadChunks() {
    const { chunks } = await api({ view: 'chunks', type: $('#ch-type').value, company: $('#ch-company').value });
    $('#ch-list').innerHTML = chunks.length ? chunks.map((c) => `<div class="chunk"><header>${tag(c.source_type)} ${esc(companyName(c.company_id))} · ${fmtDay(c.published_at)} · ${esc(c.source_name || '')} ${c.chunk_index != null ? `· ${c.chunk_index + 1}/${c.chunk_total}` : ''} · ${esc(c.embedding_model || '')} · ${fmtDate(c.created_at)} ${c.article_id ? `· <a class="link" data-article="${esc(c.article_id)}">기사</a>` : ''}</header><div class="two"><div><pre>${esc(c.content_ko)}</pre></div>${c.content_original ? `<div><pre>${esc(c.content_original)}</pre></div>` : ''}</div></div>`).join('') : '<p class="muted">없음</p>';
  }

  // ---------- 벡터 검색 시험 ----------
  async function loadSearch() {
    const q = $('#se-q').value.trim();
    if (!q) return;
    $('#se-meta').textContent = '검색 중…';
    const { results, ms } = await api({ view: 'search', q, company: $('#se-company').value, unverified: $('#se-unverified').value });
    $('#se-meta').textContent = `${results.length}건 · ${ms}ms`;
    $('#se-list').innerHTML = results.length ? results.map((r, i) => `<div class="chunk"><header><span class="sim">${r.similarity.toFixed(3)}</span> #${i + 1} ${tag(r.source_type)} ${esc(companyName(r.company_id))} · ${fmtDay(r.published_at)} · ${esc(r.source_name || '')} ${r.article_id ? `· <a class="link" data-article="${esc(r.article_id)}">기사</a>` : ''} ${r.source_url ? `· <a class="link" href="${esc(r.source_url)}" target="_blank" rel="noopener">원문</a>` : ''}</header><pre>${esc(r.content_ko)}</pre>${r.original_excerpt ? `<details><summary class="small muted">원문 발췌</summary><pre>${esc(r.original_excerpt)}</pre></details>` : ''}</div>`).join('') : '<p class="muted">근거 없음</p>';
  }

  // ---------- 파이프라인 ----------
  async function loadPipeline() {
    const { pipeline: p } = await api({ view: 'pipeline' });
    const card = (label, value, sub) => value == null || value === '' ? '' : `<div class="stat"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>`;
    const rows = (pairs) => pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><th style="width:150px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');

    const sources = p.sources.map((s) => `
      <div class="chunk">
        <header><b>${esc(s.label)}</b> <span class="tag ${esc(s.id)}">${esc(s.id)}</span></header>
        <p style="margin:6px 0 10px">${esc(s.what)}</p>
        <table class="admin">${rows([
          ['가져오는 곳', s.endpoint], ['모델', s.model], ['API 키', s.api_key],
          ['검색 묶음', s.groups ? `${s.groups}개` : null], ['묶음당 회사', s.companies_per_group],
          ['대상 회사', s.companies ? `${s.companies}곳` : null],
          ['User-Agent', s.user_agent], ['robots.txt', s.robots],
          ['저장 위치', s.stores], ['비고', s.note],
        ])}</table>
        ${s.group_labels ? `<details><summary class="small muted">묶음 ${s.group_labels.length}개 보기</summary><pre>${esc(s.group_labels.join('\n'))}</pre></details>` : ''}
      </div>`).join('');

    const stages = p.stages.map((st) => `
      <div class="chunk">
        <header><b>${esc(st.label)}</b> <span class="muted small">${esc(st.runs)}</span></header>
        <p style="margin:6px 0 10px">${esc(st.what)}</p>
        ${st.rules ? `<ul class="small" style="margin:0 0 10px 18px">${st.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${st.prompts.length ? st.prompts.map((pr) => `<details><summary class="small">프롬프트 · ${esc(pr.name)} <span class="tag ${esc(pr.provider)}">${esc(pr.provider)}</span> <span class="muted">${num(String(pr.text || '').length)}자</span></summary><pre>${esc(pr.text)}</pre></details>`).join('')
          : '<p class="muted small">LLM을 쓰지 않는 단계입니다.</p>'}
      </div>`).join('');

    const retention = p.retention.map((r) => `<tr><td><b>${esc(r.kind)}</b></td><td>${esc(r.policy)}</td><td class="muted">${esc(r.why)}</td></tr>`).join('');

    $('#pipe-body').innerHTML = `
      <div class="cards">
        ${card('추적 회사', p.universe.total, `셀 ${p.universe.cell} · 양극재 ${p.universe.cathode} · 음극재 ${p.universe.anode}`)}
        ${card('한 실행의 검색 요청', p.budget.planned_search_requests, `허용 상한 ${p.budget.allowed_search_requests}회`)}
        ${card('수집 소스', p.sources.length + '곳', '검색 2 · 공시 2 · 뉴스룸 1 · 본문 1')}
        ${card('임베딩 조각', `${num(p.embedding.chunk_chars)}자`, `겹침 ${p.embedding.chunk_overlap}자 · ${p.embedding.model}`)}
      </div>
      <p class="muted small" style="margin:0 0 6px">${esc(p.budget.note)}</p>
      <h3 style="margin:22px 0 10px">수집 소스 ${p.sources.length}곳</h3>${sources}
      <h3 style="margin:22px 0 10px">단계와 프롬프트</h3>${stages}
      <h3 style="margin:22px 0 10px">원문 보관 정책</h3>
      <div class="tbl-wrap"><table class="admin"><thead><tr><th>대상</th><th>정책</th><th>이유</th></tr></thead><tbody>${retention}</tbody></table></div>
      <p class="muted small" style="margin-top:14px">시계열 레이어 ${p.universe.layers.length}종: ${esc(p.universe.layers.join(', '))}</p>`;
  }

  async function loadProbeDigest() {
    const report = $('#probe-report').value;
    $('#probe-meta').textContent = 'PDF 읽기·추출 중…';
    $('#probe-body').innerHTML = '';
    const payload = await api({ view: 'probe-digest', report });
    const d = payload.diagnostics || {};
    const precision = Object.entries(payload.precision || {}).map(([kind, count]) => `${kind} ${num(count)}건`).join(' · ') || '—';
    const perChunk = (payload.per_chunk_returned || []).map((count, index) => `${index + 1}조각 ${count == null ? '실패' : `${num(count)}건`}`).join(' · ');
    const titles = (payload.events || []).slice(0, 12).map((event) => `<li>${esc(event.occurred_at)} · ${esc(event.occurred_precision)} · ${esc(event.title_ko)}</li>`).join('');
    const visual = (payload.visual_pages || []).length
      ? `이미지 큰 페이지 ${num(payload.visual_pages.length)}쪽 · 텍스트 밖 수치는 저장 안 함`
      : '큰 이미지 페이지 감지 없음';
    $('#probe-body').innerHTML = `
      <div class="cards">
        <div class="stat"><p class="label">저장 가능 이벤트</p><div class="value">${num(payload.rows)}</div><div class="sub">반환 ${num(payload.returned)} · 날짜 탈락 ${num(payload.dropped?.badDate)} · 빈값 ${num(payload.dropped?.empty)} · 근거 불일치 ${num(payload.dropped?.ungroundedExcerpt)}</div></div>
        <div class="stat"><p class="label">시점 정밀도</p><div class="value">${num(payload.dated_events)}</div><div class="sub">일·월 단위 · 전체: ${esc(precision)}</div></div>
        <div class="stat"><p class="label">추출 조각</p><div class="value">${num(d.digest_chunks)}</div><div class="sub">실패 ${num(d.digest_chunks_failed)} · ${num(d.section_chars)}자<br>${esc(visual)}</div></div>
      </div>
      <div class="chunk"><header><b>판정</b> · ${num(payload.ms)}ms</header><p style="margin:0 0 8px">${esc(payload.verdict)}</p><p class="small muted" style="margin:0">조각별 반환: ${esc(perChunk || '—')}</p>${titles ? `<details><summary class="small muted">이벤트 앞 12건 보기</summary><ol class="small">${titles}</ol></details>` : ''}</div>`;
    $('#probe-meta').textContent = `${num(payload.rows)}건 · ${num(payload.ms)}ms · DB 쓰기 없음`;
  }

  // ---------- RAG 평가 ----------
  //
  // 두 가지를 따로 평가한다.
  //   청크 품질   — 벡터DB에 들어간 청크 하나가 근거로 쓸 만한가.
  //   검색 정밀도 — 질문 하나에 검색이 돌려준 근거가 그 질문에 맞는가.
  // 판정을 누르면 바로 저장한다. 저장 버튼을 따로 두면 라벨링 속도가 절반이 되고, 누른 줄 알았는데
  // 안 눌린 상태가 생긴다. 사유 태그·메모를 바꾸면 판정이 있는 경우에만 다시 저장한다.
  let evalCatalog = null;
  let evalSchemaMissing = false;
  let ecOffset = 0;
  let ecNextOffset = null;
  let ecShown = 0;
  let retrievalContext = null;
  const evalSub = { current: 'eval-chunks' };

  function noteSchema(missing) {
    if (missing) evalSchemaMissing = true;
    $('#eval-schema').hidden = !evalSchemaMissing;
  }

  // 판정·사유·메모 줄. 이미 저장된 판정이 있으면 그 상태로 그린다.
  function evalBar(subject, evaluation) {
    const tags = evalCatalog?.issue_tags?.[subject] || [];
    const chosen = new Set(evaluation?.issue_tags || []);
    const verdicts = (evalCatalog?.verdicts || []).map((verdict) => `<button type="button" data-verdict="${esc(verdict.id)}" class="${evaluation?.verdict === verdict.id ? 'is-on' : ''}">${esc(subject === 'chunk' ? verdict.label_chunk : verdict.label_retrieval)}</button>`).join('');
    return `<div class="eval-bar">
      <div class="verdicts">${verdicts}</div>
      <div class="eval-tags">${tags.map((tag) => `<label class="${chosen.has(tag.id) ? 'is-on' : ''}"><input type="checkbox" data-eval-tag="${esc(tag.id)}" ${chosen.has(tag.id) ? 'checked' : ''} />${esc(tag.label)}</label>`).join('')}</div>
      <input class="eval-note" type="text" placeholder="메모(선택) · 무엇이 문제인지 한 줄" value="${esc(evaluation?.note || '')}" />
      ${evaluation?.id ? `<button type="button" class="link small" data-eval-clear="${esc(evaluation.id)}">판정 취소</button>` : ''}
      <span class="eval-state${evaluation ? ' saved' : ''}">${evaluation ? `저장됨 ${fmtDate(evaluation.updated_at)}` : '미평가'}</span>
    </div>`;
  }

  function verdictClass(evaluation) {
    if (!evaluation) return '';
    return evaluation.verdict === 'good' ? ' is-done' : evaluation.verdict === 'bad' ? ' is-bad' : ' is-partial';
  }

  function cardPayload(card) {
    const subject = card.dataset.evalSubject;
    const verdict = card.querySelector('.verdicts button.is-on')?.dataset.verdict || '';
    const issueTags = [...card.querySelectorAll('[data-eval-tag]')].filter((input) => input.checked).map((input) => input.dataset.evalTag);
    const note = card.querySelector('.eval-note')?.value || '';
    const base = {
      subject_type: subject, verdict, issue_tags: issueTags, note,
      chunk_id: card.dataset.chunkId,
      chunk_source_type: card.dataset.chunkType || null,
      company_id: card.dataset.company || null,
    };
    if (subject === 'chunk') return base;
    return {
      ...base,
      question: retrievalContext?.question || '',
      filter_company_id: retrievalContext?.company || null,
      include_unverified: Boolean(retrievalContext?.include_unverified),
      result_rank: Number(card.dataset.rank),
      retrieved_by: (card.dataset.retrievedBy || '').split(',').filter(Boolean),
      similarity: card.dataset.similarity ? Number(card.dataset.similarity) : null,
    };
  }

  async function saveEvaluation(card) {
    const state = card.querySelector('.eval-state');
    const payload = cardPayload(card);
    if (!payload.verdict) return;
    state.className = 'eval-state';
    state.textContent = '저장 중…';
    try {
      const { evaluation } = await postApi('eval-save', payload);
      state.className = 'eval-state saved';
      state.textContent = `저장됨 ${fmtDate(evaluation?.updated_at)}`;
      card.className = `chunk eval-card${verdictClass(evaluation)}`;
      const clear = card.querySelector('[data-eval-clear]');
      if (evaluation?.id && !clear) {
        state.insertAdjacentHTML('beforebegin', `<button type="button" class="link small" data-eval-clear="${esc(evaluation.id)}">판정 취소</button>`);
      } else if (evaluation?.id && clear) {
        clear.dataset.evalClear = evaluation.id;
      }
    } catch (error) {
      state.className = 'eval-state failed';
      state.textContent = `저장 실패: ${error.message}`;
    }
  }

  async function clearEvaluation(card, id) {
    const state = card.querySelector('.eval-state');
    state.className = 'eval-state';
    state.textContent = '취소 중…';
    try {
      await postApi('eval-delete', { id });
      card.querySelectorAll('.verdicts button').forEach((button) => button.classList.remove('is-on'));
      card.querySelectorAll('[data-eval-tag]').forEach((input) => { input.checked = false; input.closest('label').classList.remove('is-on'); });
      card.querySelector('.eval-note').value = '';
      card.className = 'chunk eval-card';
      card.querySelector('[data-eval-clear]')?.remove();
      state.className = 'eval-state';
      state.textContent = '미평가';
    } catch (error) {
      state.className = 'eval-state failed';
      state.textContent = `취소 실패: ${error.message}`;
    }
  }

  // --- 청크 품질 ---
  function chunkCard(chunk) {
    const evaluation = chunk.evaluation;
    return `<div class="chunk eval-card${verdictClass(evaluation)}" data-eval-subject="chunk" data-chunk-id="${esc(chunk.id)}" data-chunk-type="${esc(chunk.source_type)}" data-company="${esc(chunk.company_id || '')}">
      <header>${tag(chunk.source_type)} ${esc(companyName(chunk.company_id))} · ${fmtDay(chunk.published_at)} · ${esc(chunk.source_name || '')} ${chunk.chunk_index != null ? `· ${chunk.chunk_index + 1}/${chunk.chunk_total}` : ''} · ${esc(chunk.embedding_model || '벡터 없음')} ${chunk.article_id ? `· <a class="link" data-article="${esc(chunk.article_id)}">기사</a>` : ''} ${chunk.source_url ? `· <a class="link" href="${esc(chunk.source_url)}" target="_blank" rel="noopener">원문</a>` : ''}</header>
      <div class="two"><div><div class="small muted">임베딩 입력(content_ko)</div><pre>${esc(chunk.content_ko)}</pre></div>${chunk.content_original || chunk.original_excerpt ? `<div><div class="small muted">${chunk.content_original ? '원문 조각(content_original)' : '원문 발췌(original_excerpt)'}</div><pre>${esc(chunk.content_original || chunk.original_excerpt)}</pre></div>` : ''}</div>
      ${evalBar('chunk', evaluation)}
    </div>`;
  }

  async function loadEvalChunks(append = false) {
    if (!append) { ecOffset = 0; ecShown = 0; $('#ec-list').innerHTML = ''; }
    $('#ec-count').textContent = '불러오는 중…';
    const payload = await api({
      view: 'eval-chunks', type: $('#ec-type').value, company: $('#ec-company').value,
      state: $('#ec-state').value, novector: $('#ec-novector').value, q: $('#ec-q').value,
      offset: ecOffset,
    });
    evalCatalog = payload.catalog || evalCatalog;
    noteSchema(payload.schema_missing);
    ecNextOffset = payload.next_offset;
    ecOffset = payload.next_offset ?? ecOffset;
    ecShown += payload.chunks.length;
    const html = payload.chunks.map(chunkCard).join('');
    if (append) $('#ec-list').insertAdjacentHTML('beforeend', html);
    else $('#ec-list').innerHTML = html || '<p class="muted">조건에 맞는 청크가 없습니다.</p>';
    $('#ec-more').hidden = ecNextOffset == null;
    $('#ec-count').textContent = `${ecShown}건 표시 · 지금까지 평가한 청크 ${num(payload.evaluated_total)}건${ecNextOffset == null ? ' · 끝까지 훑었습니다' : ''}`;
  }

  // --- 검색 정밀도 ---
  function retrievalCard(row) {
    const by = row.retrieved_by || [];
    const byLabel = by.length > 1 ? '의미+단어' : by[0] === 'lexical' ? '단어 검색' : by[0] === 'vector' ? '의미 검색' : '미상';
    // 이 질문으로 이미 저장된 평가 문항의 정답 청크는 체크된 채로 그린다. 그래야 다시 검색해도
    // 무엇이 정답인지 보이고, 평가 세트로 넘길 때 기존 정답이 빠지지 않는다.
    const saved = (retrievalContext?.benchmark_case?.reference_chunk_ids || []).includes(row.id);
    return `<div class="chunk eval-card${verdictClass(row.evaluation)}" data-eval-subject="retrieval" data-chunk-id="${esc(row.id)}" data-chunk-type="${esc(row.source_type)}" data-company="${esc(row.company_id || '')}" data-rank="${esc(row.rank)}" data-retrieved-by="${esc(by.join(','))}" data-similarity="${esc(row.similarity ?? '')}">
      <header><label class="er-pick${saved ? ' is-on' : ''}"><input type="checkbox" data-pick="${esc(row.id)}"${saved ? ' checked' : ''} /> 정답${saved ? ' · 저장됨' : ''}</label> <span class="sim">${Number(row.similarity || 0).toFixed(3)}</span> #${row.rank} <span class="tag">${esc(byLabel)}</span> ${tag(row.source_type)} ${esc(companyName(row.company_id))} · ${fmtDay(row.published_at)} · ${esc(row.source_name || '')} ${row.article_id ? `· <a class="link" data-article="${esc(row.article_id)}">기사</a>` : ''} ${row.source_url ? `· <a class="link" href="${esc(row.source_url)}" target="_blank" rel="noopener">원문</a>` : ''}</header>
      <pre>${esc(row.content_ko)}</pre>
      ${row.original_excerpt ? `<details><summary class="small muted">원문 발췌</summary><pre>${esc(row.original_excerpt)}</pre></details>` : ''}
      ${evalBar('retrieval', row.evaluation)}
    </div>`;
  }

  async function loadEvalRetrieval() {
    const question = $('#er-q').value.trim();
    if (!question) { $('#er-meta').textContent = '질문을 입력하세요.'; return; }
    $('#er-meta').textContent = '검색 중…';
    const payload = await api({
      view: 'eval-search', q: question, company: $('#er-company').value,
      unverified: $('#er-unverified').value, limit: $('#er-limit').value,
    });
    evalCatalog = payload.catalog || evalCatalog;
    noteSchema(payload.schema_missing);
    retrievalContext = { question: payload.question, company: payload.company || null, include_unverified: payload.include_unverified, benchmark_case: payload.benchmark_case || null };
    const stats = payload.retrieval;
    const done = payload.results.filter((row) => row.evaluation).length;
    // 저장된 정답 중 이번 결과에 안 보이는 것이 있으면 알려준다. 검색이 바뀌어 정답이 상위 10 밖으로
    // 밀렸다는 뜻이고, 그 정답은 체크할 수 없어도 평가 세트에는 그대로 남는다.
    const savedIds = payload.benchmark_case?.reference_chunk_ids || [];
    const savedShown = payload.results.filter((row) => savedIds.includes(row.id)).length;
    $('#er-meta').textContent = [
      `${payload.results.length}건 · ${payload.ms}ms`,
      stats ? `의미 ${stats.vector_matched}건 + 단어 ${stats.lexical_matched}건 → 후보 ${stats.candidates}건(겹침 ${stats.overlapped}건)` : '',
      stats && !stats.lexical_available ? '단어 검색 미작동' : '',
      stats && !stats.vector_available ? '의미 검색 미작동' : '',
      done ? `이미 평가한 근거 ${done}건` : '',
      savedIds.length ? `평가 세트 정답 ${savedIds.length}건 중 이 결과에 ${savedShown}건` : '',
    ].filter(Boolean).join(' · ');
    $('#er-list').innerHTML = payload.results.length ? payload.results.map(retrievalCard).join('') : '<p class="muted">근거 없음</p>';
  }

  // --- 집계 ---
  function scoreCell(entry) {
    const score = entry.score == null ? '—' : entry.score.toFixed(2);
    return `${score}<div class="bar"><span style="width:${entry.score == null ? 0 : Math.round(entry.score * 100)}%"></span></div>`;
  }

  async function loadEvalSummary() {
    $('#es-meta').textContent = '집계 중…';
    const payload = await api({ view: 'eval-summary' });
    evalCatalog = payload.catalog || evalCatalog;
    noteSchema(payload.schema_missing);
    const { chunk, retrieval } = payload.summary;
    const card = (label, value, sub = '', warn = false) => `<div class="stat${warn ? ' warn' : ''}"><p class="label">${esc(label)}</p><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    const breakdown = (entry) => `쓸 만함 ${num(entry.good)} · 애매 ${num(entry.partial)} · 못 씀 ${num(entry.bad)}`;
    const tally = (rows, labelOf) => `<div class="tbl-wrap"><table class="admin"><thead><tr><th>구분</th><th>평가</th><th>쓸 만함</th><th>애매</th><th>못 씀</th><th>점수</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${esc(labelOf ? labelOf(row.key) : row.key)}${row.corpus != null ? `<div class="muted small">코퍼스 ${num(row.corpus)}건 중 ${Math.round((row.total / row.corpus) * 100)}%</div>` : ''}</td><td class="num">${num(row.total)}</td><td class="num">${num(row.good)}</td><td class="num">${num(row.partial)}</td><td class="num">${num(row.bad)}</td><td class="num">${scoreCell(row)}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">없음</td></tr>'}</tbody></table></div>`;
    const tagList = (tags) => tags.length ? `<div class="tbl-wrap"><table class="admin"><thead><tr><th>사유</th><th>건수</th></tr></thead><tbody>${tags.map((issue) => `<tr><td>${esc(issue.label)}</td><td class="num">${num(issue.count)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">기록된 사유가 없습니다.</p>';

    const sessions = payload.sessions || [];
    $('#es-body').innerHTML = `
      <div class="cards">
        ${card('청크 평가', `${num(chunk.evaluated)}건`, chunk.corpus ? `전체 ${num(chunk.corpus)}건의 ${chunk.coverage == null ? '—' : Math.round(chunk.coverage * 100)}%` : '')}
        ${card('청크 점수', chunk.score == null ? '—' : chunk.score.toFixed(2), breakdown(chunk))}
        ${card('검색 평가', `${num(retrieval.evaluated)}건`, `질문 ${num(retrieval.questions)}개`)}
        ${card('검색 정밀도', retrieval.score == null ? '—' : retrieval.score.toFixed(2), breakdown(retrieval))}
      </div>
      <p class="muted small" style="margin:0 0 18px">점수는 쓸 만함 1점, 애매 0.5점, 못 씀 0점의 평균입니다. 표본이 적으면 점수보다 원 건수를 봅니다. 평가하지 않은 것은 분모에 넣지 않습니다.</p>
      <h3 class="sub">청크 품질 · 종류별</h3>${tally(chunk.by_source_type)}
      <h3 class="sub">청크 품질 · 회사별</h3>${tally(chunk.by_company, companyName)}
      <h3 class="sub">청크 품질 · 사유</h3>${tagList(chunk.issue_tags)}
      <h3 class="sub">검색 정밀도 · 어느 검색기가 건졌나</h3>${tally(retrieval.by_retriever)}
      <p class="muted small" style="margin:6px 0 0">가중치(현재 의미 0.5 / 단어 0.5)를 바꿀 근거는 이 표뿐입니다. 한쪽 점수가 낮으면 그 검색기의 가중치를 내립니다.</p>
      <h3 class="sub">검색 정밀도 · 순위 구간별</h3>${tally(retrieval.by_rank)}
      <h3 class="sub">검색 정밀도 · 사유</h3>${tagList(retrieval.issue_tags)}
      <h3 class="sub">질문별 (${sessions.length})</h3>
      <div class="tbl-wrap"><table class="admin"><thead><tr><th>질문</th><th>회사 필터</th><th>평가</th><th>관련</th><th>부분</th><th>무관</th><th>정밀도</th><th>상위 5건</th><th>가장 앞선 무관</th><th>최근 평가</th></tr></thead><tbody>${sessions.length ? sessions.map((session) => `<tr>
        <td>${esc(session.question)}${session.include_unverified ? ' <span class="tag">미검증 포함</span>' : ''}</td>
        <td class="small">${esc(session.filter_company_id ? companyName(session.filter_company_id) : '전체')}</td>
        <td class="num">${num(session.evaluated)}</td><td class="num">${num(session.good)}</td><td class="num">${num(session.partial)}</td><td class="num">${num(session.bad)}</td>
        <td class="num">${session.precision == null ? '—' : session.precision.toFixed(2)}</td>
        <td class="num">${session.precision_at_5 == null ? '—' : session.precision_at_5.toFixed(2)}</td>
        <td class="num">${session.top_rank_bad == null ? '—' : `${session.top_rank_bad}위`}</td>
        <td class="small">${fmtDate(session.last_evaluated_at)}</td></tr>`).join('') : '<tr><td colspan="10" class="muted">아직 검색 평가가 없습니다.</td></tr>'}</tbody></table></div>`;
    $('#es-meta').textContent = `평가 ${num(chunk.evaluated + retrieval.evaluated)}건 집계`;
  }

  async function loadEvalBenchmark() {
    const payload = await api({ view: 'benchmark-cases' });
    const rows = payload.cases || [];
    $('#eb-list').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="admin"><thead><tr><th>제목</th><th>질문</th><th>회사</th><th>정답 청크</th><th>상태</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.title)}</td><td>${esc(row.question)}</td><td>${esc(companyName(row.company_id) || '전체')}</td><td class="num">${num((row.reference_chunk_ids || []).length)}</td><td>${row.active ? '사용' : '중지'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">아직 평가 문제가 없습니다.</p>';
  }

  const evalLoaders = { 'eval-chunks': () => loadEvalChunks(false), 'eval-retrieval': loadEvalRetrieval, 'eval-summary': loadEvalSummary, 'eval-benchmark': loadEvalBenchmark };
  const evalLoaded = new Set();
  async function showEvalSub(sub, force = false) {
    evalSub.current = sub;
    document.querySelectorAll('.subnav button').forEach((button) => button.classList.toggle('is-active', button.dataset.sub === sub));
    document.querySelectorAll('.subpanel').forEach((panel) => panel.classList.toggle('is-visible', panel.id === `sub-${sub}`));
    // 검색 평가는 질문을 받아야 돌아가므로 화면을 열었다고 자동 실행하지 않는다.
    if (sub === 'eval-retrieval') return;
    if (!evalLoaded.has(sub) || force) {
      showError(null);
      try { await evalLoaders[sub](); evalLoaded.add(sub); } catch (error) { showError(error); }
    }
  }
  async function loadEval() {
    evalLoaded.delete(evalSub.current);
    await showEvalSub(evalSub.current, true);
  }

  // ---------- 공통 ----------
  async function loadCompanies() {
    try {
      const result = await fetch('/api/company', { cache: 'no-store' });
      const payload = await result.json();
      const list = payload.companies || [];
      for (const c of list) companies.set(c.id, c.name_ko);
      const options = `<option value="">전체</option>${list.map((c) => `<option value="${esc(c.id)}">${esc(c.name_ko)}</option>`).join('')}`;
      for (const id of ['#art-company', '#ev-company', '#ch-company', '#se-company', '#audit-company', '#ec-company', '#er-company', '#eb-company']) $(id).innerHTML = options;
    } catch {}
  }
  async function loadCompanyTracking() {
    const payload = await api({ view: 'companies' });
    const rows = payload.companies || [];
    $('#company-tracking-table').innerHTML = `<thead><tr><th>기업</th><th>중국어명</th><th>밸류체인</th><th>코드</th><th>상태</th><th></th></tr></thead><tbody>${rows.map((company) => `<tr><td><b>${esc(company.name_ko)}</b></td><td>${esc(company.name_zh || '—')}</td><td>${esc((company.type_tags || []).join(' · '))}</td><td>${esc(company.ticker || '비상장')}</td><td>${company.active ? '<span class="tag ok">활성</span>' : '<span class="tag">비활성</span>'}</td><td><button class="secondary-button" data-company-toggle="${esc(company.id)}" data-company-active="${company.active}">${company.active ? '비활성화' : '활성화'}</button></td></tr>`).join('')}</tbody>`;
  }
  const loaders = { overview: loadOverview, companies: loadCompanyTracking, audit: loadAudit, runs: loadRuns, articles: loadArticles, events: loadEvents, chunks: loadChunks, search: loadSearch, pipeline: loadPipeline, eval: loadEval };
  const loaded = new Set();
  let current = 'overview';
  async function show(panel, force = false) {
    current = panel;
    document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.panel === panel));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('is-visible', p.id === `panel-${panel}`));
    if (!loaded.has(panel) || force) {
      showError(null);
      try { await loaders[panel](); loaded.add(panel); } catch (error) { showError(error); }
    }
    history.replaceState(null, '', `#${panel}`);
  }
  document.querySelectorAll('.admin-nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.panel)));
  $('#admin-refresh').addEventListener('click', () => show(current, true));
  const reload = (id, panel) => $(id).addEventListener('click', async () => { showError(null); try { await loaders[panel](); } catch (error) { showError(error); } });
  reload('#audit-load', 'audit'); reload('#runs-load', 'runs'); reload('#art-load', 'articles'); reload('#ev-load', 'events'); reload('#ch-load', 'chunks'); reload('#se-load', 'search');
  $('#probe-load').addEventListener('click', () => runEval(loadProbeDigest));

  // 평가 화면 배선
  document.querySelectorAll('.subnav button').forEach((button) => button.addEventListener('click', () => showEvalSub(button.dataset.sub)));
  const runEval = async (fn) => { showError(null); try { await fn(); } catch (error) { showError(error); } };
  $('#ec-load').addEventListener('click', () => runEval(() => loadEvalChunks(false)));
  $('#ec-more').addEventListener('click', () => runEval(() => loadEvalChunks(true)));
  $('#er-load').addEventListener('click', () => runEval(loadEvalRetrieval));
  // 기준 답변 초안. 사람이 정답으로 체크한 근거의 사실 부분만 모은다 — 근거에 없는 문장은 넣지 않는다.
  // 이번 주 지표(Hit@10·MRR)는 기준 답변을 읽지 않지만 DB가 필수로 잡고 있어 빈 채로는 저장이 안 된다.
  // RAGAS를 붙일 때 사람이 다듬는 출발점이므로, 화면은 "초안"임을 알리고 그대로 저장할지는 사람이 정한다.
  // 회사를 한정하지 않고 검색하면 근거마다 회사가 다르므로, 각 줄 앞에 회사를 붙인다.
  // 이벤트 청크의 [회사] 줄을 우선 쓰고(표시명이 들어 있다), 없으면 카드의 회사 ID로 이름을 찾는다.
  function draftReferenceAnswer(items) {
    const facts = [];
    for (const item of items) {
      const raw = typeof item === 'string' ? item : item?.text;
      const text = String(raw || '').replace(/\r\n/g, '\n');
      const taggedCompany = text.match(/\[회사\]\s*([^\n]*)/)?.[1]?.trim() || '';
      const company = taggedCompany || (typeof item === 'object' && item?.company ? String(item.company).trim() : '');
      let fact = '';
      const event = text.match(/\[사실\]\s*([\s\S]*?)(?:\n\[|$)/);
      if (event) fact = event[1];
      else {
        const article = text.match(/\[한국어 팩트 요약\]\s*\n([\s\S]*?)(?:\n\[원문|$)/);
        if (article) fact = article[1];
        else {
          const headline = text.match(/\[제목\]\s*([^\n]*)/);
          fact = headline ? headline[1] : (text.split('\n').find((line) => line.trim() && !line.trim().startsWith('[')) || '');
        }
      }
      fact = fact.replace(/\s*\n\s*(?:-\s*)?/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 240);
      if (!fact) continue;
      // 사실 문장이 이미 그 회사 이름으로 시작하면 중복해 붙이지 않는다.
      const shortName = company.replace(/\([^)]*\)/g, '').trim();
      const line = company && !(shortName && fact.startsWith(shortName)) ? `${company} · ${fact}` : fact;
      if (!facts.includes(line)) facts.push(line);
    }
    return facts.map((line) => `- ${line}`).join('\n').slice(0, 5900);
  }
  // 검색 정밀도에서 고른 정답 청크를 평가 세트로 옮긴다. 청크 ID는 화면에 글자로 보이지 않아
  // 사람이 옮겨 적을 수 없었고, 정답 청크가 없으면 Hit@10·MRR이 0으로만 나온다.
  // 검색 조건이 다르면 같은 질문이라도 다른 근거가 나오므로 회사·보조 데이터도 함께 옮긴다.
  $('#er-to-benchmark').addEventListener('click', () => runEval(async () => {
    const picked = [...document.querySelectorAll('#er-list [data-pick]')].filter((input) => input.checked).map((input) => input.dataset.pick);
    if (!picked.length) { $('#er-meta').textContent = '정답으로 쓸 근거를 먼저 체크하세요.'; return; }
    const context = retrievalContext || {};
    const question = context.question || $('#er-q').value.trim();
    const saved = context.benchmark_case || null;
    // 저장된 문항이 있으면 화면에 안 보여서 체크 못 한 정답도 합쳐 넘긴다. 체크를 풀어 뺀 것은 뺀다.
    const shownIds = new Set([...document.querySelectorAll('#er-list [data-pick]')].map((input) => input.dataset.pick));
    const hidden = (saved?.reference_chunk_ids || []).filter((id) => !shownIds.has(id));
    const merged = [...new Set([...picked, ...hidden])];
    $('#eb-question').value = question;
    $('#eb-title').value = saved?.title || $('#eb-title').value.trim() || question.slice(0, 160);
    // 기준 답변은 저장 필수 항목이라, 저장된 문항이면 그 답변을, 새 문항이면 체크한 근거에서 뽑은 초안을 채운다.
    // 사람이 이미 적어 둔 것이 있으면 건드리지 않는다.
    let drafted = false;
    if (!$('#eb-reference').value.trim()) {
      if (saved?.reference_answer) $('#eb-reference').value = saved.reference_answer;
      else {
        const items = [...document.querySelectorAll('#er-list [data-pick]:checked')].map((input) => {
          const card = input.closest('.eval-card');
          return { text: card?.querySelector('pre')?.textContent || '', company: card?.dataset.company ? companyName(card.dataset.company) : '' };
        });
        const draft = draftReferenceAnswer(items);
        if (draft) { $('#eb-reference').value = draft; drafted = true; }
      }
    }
    $('#eb-chunks').value = merged.join(', ');
    $('#eb-company').value = context.company || '';
    $('#eb-unverified').checked = context.include_unverified === true;
    await showEvalSub('eval-benchmark');
    $('#eb-meta').textContent = saved
      ? `저장된 문항을 갱신합니다 · 정답 청크 ${merged.length}건(화면에서 고른 ${picked.length}건${hidden.length ? ` + 이번 결과에 없던 기존 정답 ${hidden.length}건` : ''}). 저장하면 기존 문항이 바뀝니다.`
      : `정답 청크 ${picked.length}건을 옮겼습니다. ${drafted ? '기준 답변은 체크한 근거의 사실을 모은 초안입니다 — 확인하고 저장하세요.' : '기준 답변을 적고 저장하세요.'}`;
  }));
  $('#es-load').addEventListener('click', () => runEval(loadEvalSummary));
  $('#eb-save').addEventListener('click', () => runEval(async () => {
    const ids = $('#eb-chunks').value.split(',').map(value => value.trim()).filter(Boolean);
    const question = $('#eb-question').value.trim();
    const reference = $('#eb-reference').value.trim();
    // 서버는 제목·질문·기준 답변이 모두 있어야 저장하고, 하나라도 비면 invalid_benchmark_case를
    // 돌려준다. 무엇이 비었는지 화면에서 먼저 알려준다.
    if (!question || !reference) { $('#eb-meta').textContent = !question ? '질문을 입력하세요.' : '기준 답변을 입력하세요.'; return; }
    // 제목은 목록에서 문항을 알아보는 이름일 뿐이라, 비면 질문으로 채운다.
    const title = $('#eb-title').value.trim() || question.slice(0, 160);
    if (!ids.length) $('#eb-meta').textContent = '정답 청크가 없습니다. 저장은 되지만 Hit@10·MRR은 0으로 나옵니다.';
    // api()는 GET 전용이라 method·body를 무시한다. 쓰기는 반드시 postApi()로 보낸다 —
    // 예전에는 api()에 method를 넘겨 GET으로 나갔고 서버가 unknown_view로 되돌렸다.
    const result = await postApi('benchmark-case-save', { title, question, reference_answer: reference, reference_chunk_ids: ids, company_id: $('#eb-company').value || null, include_unverified: $('#eb-unverified').checked });
    if (ids.length) $('#eb-meta').textContent = `${result?.replaced ? '기존 문항을 갱신했습니다' : '새 문항을 저장했습니다'} · 정답 청크 ${ids.length}건`;
    if (retrievalContext && retrievalContext.question === question) retrievalContext.benchmark_case = result?.case || retrievalContext.benchmark_case;
    $('#eb-title').value = ''; $('#eb-question').value = ''; $('#eb-reference').value = ''; $('#eb-chunks').value = ''; await loadEvalBenchmark();
  }));
  // 실패해도 "실행 중…"이 남으면 사용자가 계속 기다린다. 어떤 경로로 끝나든 문구를 바꾼다.
  $('#eb-run').addEventListener('click', () => runEval(async () => {
    $('#eb-meta').textContent = '검색 평가 실행 중…';
    try {
      const result = await postApi('benchmark-run', {});
      if (result.error) {
        $('#eb-meta').textContent = result.error === 'no_benchmark_cases' ? '평가 문제가 없습니다. 먼저 문제를 저장하세요.' : `실행 실패: ${result.error}`;
        return;
      }
      const m = result.metrics || {};
      // 답 없음 문항은 점수 분모에 없다. 따로 보여야 "문항 수가 줄었다"로 안 읽힌다.
      $('#eb-meta').textContent = `완료 · Hit@10 ${Number(m.hit_rate_at_10 || 0).toFixed(2)} · MRR ${Number(m.mrr || 0).toFixed(2)} · Recall@10 ${m.recall_at_10 == null ? '—' : Number(m.recall_at_10).toFixed(2)} · 채점 ${num(m.evaluated || 0)}문항${m.abstention_cases ? ` + 답 없음 ${num(m.abstention_cases)}문항(분모 제외)` : ''}${m.failed ? ` · 실패 ${num(m.failed)}문항` : ''}${m.commit ? ` · 코드 ${m.commit.slice(0, 7)}` : ''}`;
    } catch (error) {
      $('#eb-meta').textContent = `실행 실패: ${error.message || error}`;
      throw error;
    }
  }));
  for (const id of ['#ec-type', '#ec-company', '#ec-state', '#ec-novector']) $(id).addEventListener('change', () => runEval(() => loadEvalChunks(false)));
  $('#ec-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ec-load').click(); });
  $('#er-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#er-load').click(); });

  // 판정은 누르는 즉시 저장한다. 사유 태그·메모는 판정이 있을 때만 다시 저장한다.
  document.addEventListener('click', (e) => {
    const verdictButton = e.target.closest('.verdicts button');
    if (verdictButton) {
      const card = verdictButton.closest('.eval-card');
      const on = verdictButton.classList.contains('is-on');
      card.querySelectorAll('.verdicts button').forEach((button) => button.classList.remove('is-on'));
      if (!on) { verdictButton.classList.add('is-on'); saveEvaluation(card); }
      return;
    }
    const clearButton = e.target.closest('[data-eval-clear]');
    if (clearButton) clearEvaluation(clearButton.closest('.eval-card'), clearButton.dataset.evalClear);
  });
  document.addEventListener('change', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { pick.closest('label').classList.toggle('is-on', pick.checked); return; }
    const tagInput = e.target.closest('[data-eval-tag]');
    if (!tagInput) return;
    tagInput.closest('label').classList.toggle('is-on', tagInput.checked);
    saveEvaluation(tagInput.closest('.eval-card'));
  });
  document.addEventListener('blur', (e) => {
    const note = e.target.closest && e.target.closest('.eval-note');
    if (note) saveEvaluation(note.closest('.eval-card'));
  }, true);
  for (const id of ['#audit-severity', '#audit-kind', '#audit-company']) $(id).addEventListener('change', renderAudit);
  $('#audit-q').addEventListener('input', renderAudit);
  $('#audit-export').addEventListener('click', exportAudit);
  $('#se-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#se-load').click(); });
  $('#art-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#art-load').click(); });
  document.addEventListener('click', (e) => {
    const companyToggle = e.target.closest('[data-company-toggle]');
    if (companyToggle) {
      e.preventDefault();
      const active = companyToggle.dataset.companyActive !== 'true';
      companyToggle.disabled = true;
      postApi('company-tracking-save', { company_id: companyToggle.dataset.companyToggle, is_active: active })
        .then(() => loadCompanyTracking()).catch(showError).finally(() => { companyToggle.disabled = false; });
      return;
    }
    const link = e.target.closest('[data-article]');
    if (link) { e.preventDefault(); openArticle(link.dataset.article); return; }
    if (e.target.closest('[data-close]')) $('#drawer').hidden = true;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer').hidden = true; });

  // 입장 게이트가 앱 셸을 열 때까지 기다린 뒤 시작한다.
  const shell = $('#app-shell');
  const start = async () => { await loadCompanies(); const initial = location.hash.replace('#', ''); await show(loaders[initial] ? initial : 'overview'); };
  if (!shell.hidden) start();
  else new MutationObserver((_, observer) => { if (!shell.hidden) { observer.disconnect(); start(); } }).observe(shell, { attributes: true, attributeFilter: ['hidden'] });
})();
