// 관리자 페이지. /api/admin?view=... 를 읽어 파이프라인 중간 산출물을 그대로 그린다. 쓰기 동작은 없다.
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
  function showError(error) { const box = $('#admin-error'); box.hidden = !error; box.textContent = error ? `조회 실패: ${error.message || error}` : ''; }
  function table(el, headers, rows) {
    el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="muted">없음</td></tr>`}</tbody>`;
  }

  // ---------- 개요 ----------
  async function loadOverview() {
    const { overview, last_runs } = await api({ view: 'overview' });
    const byStatus = overview.articles_by_status || [];
    const total = byStatus.reduce((s, r) => s + r.count, 0);
    const verified = byStatus.filter((r) => ['pending_review', 'approved'].includes(r.verification_status)).reduce((s, r) => s + r.count, 0);
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

  // ---------- 공통 ----------
  async function loadCompanies() {
    try {
      const result = await fetch('/api/company', { cache: 'no-store' });
      const payload = await result.json();
      const list = payload.companies || [];
      for (const c of list) companies.set(c.id, c.name_ko);
      const options = `<option value="">전체</option>${list.map((c) => `<option value="${esc(c.id)}">${esc(c.name_ko)}</option>`).join('')}`;
      for (const id of ['#art-company', '#ev-company', '#ch-company', '#se-company', '#audit-company']) $(id).innerHTML = options;
    } catch {}
  }
  const loaders = { overview: loadOverview, audit: loadAudit, runs: loadRuns, articles: loadArticles, events: loadEvents, chunks: loadChunks, search: loadSearch, pipeline: loadPipeline };
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
  for (const id of ['#audit-severity', '#audit-kind', '#audit-company']) $(id).addEventListener('change', renderAudit);
  $('#audit-q').addEventListener('input', renderAudit);
  $('#audit-export').addEventListener('click', exportAudit);
  $('#se-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#se-load').click(); });
  $('#art-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#art-load').click(); });
  document.addEventListener('click', (e) => {
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
