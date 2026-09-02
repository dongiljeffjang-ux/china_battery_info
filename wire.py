# -*- coding: utf-8 -*-
import io


def load(p):
    return io.open(p, encoding='utf-8').read()


def save(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def swap(s, old, new, why):
    assert old in s and s.count(old) == 1, f'못 찾음/중복({why})'
    return s.replace(old, new, 1)


# ── API: 시점 재확인 ──────────────────────────────────────────────
p = 'api/ingest-rss.js'
s = load(p)
s = swap(s,
         'import { backfillCompanyEvents, digestReport } from "../lib/event-backfill.js";',
         'import { backfillCompanyEvents, digestReport, redateReportEvents } from "../lib/event-backfill.js";',
         'import')

s = swap(s, 'async function handleRequest(request, response) {',
'''// 이미 저장된 연차보고서 이벤트의 시점을 다시 확인한다.
// 기간 집계는 보고 기간 말일이 맞으므로 그대로 두고, 시점 사건만 실제 시기를 찾아 고친다.
async function runRedate(response, companyId) {
  const company = COMPANIES.find((item) => item.id === companyId);
  if (!company) return response.status(404).json({ status: "unknown_company", company_id: companyId });
  if (!llmConfig("auto")) return response.status(503).json({ status: "llm_not_configured" });
  try {
    // 아직 확인하지 않은 것만 집는다. 한 번 확인한 이벤트를 다시 검색하면 비용만 든다.
    const events = await supabaseRest(`event?select=id,occurred_at,title_ko,fact_ko&company_id=eq.${encodeURIComponent(companyId)}&evidence_kind=eq.annual_report&occurred_basis=is.null&order=occurred_at.asc&limit=20`);
    if (!events.length) return response.status(200).json({ status: "ok", company_id: companyId, company_name: company.name_ko, checked: 0, changed: 0, remaining: 0 });
    const { items, checked, provider } = await redateReportEvents({ company, events });
    let changed = 0;
    for (const item of items) {
      await supabaseRest(`event?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { occurred_at: item.occurred_at, occurred_precision: item.occurred_precision, occurred_basis: item.occurred_basis }
      });
      if (item.changed) changed += 1;
    }
    // 시점이 바뀐 이벤트는 벡터 청크의 [시점] 줄도 달라지므로 다시 임베딩한다.
    let embedded = 0;
    if (items.length) {
      try {
        const updated = await supabaseRest(`event?select=*&id=in.(${items.map((item) => item.id).join(",")})`);
        embedded = (await embedEvents((updated || []).map((row) => ({ ...row, company_name_ko: company.name_ko })))).chunks;
      } catch (error) {
        console.error("[REDATE_EMBEDDING_FAILED]", JSON.stringify({ companyId, message: error.message }));
      }
    }
    const left = await supabaseRest(`event?select=id&company_id=eq.${encodeURIComponent(companyId)}&evidence_kind=eq.annual_report&occurred_basis=is.null&limit=200`);
    console.info("[REDATE_DONE]", JSON.stringify({ companyId, checked, changed, remaining: left.length }));
    return response.status(200).json({ status: "ok", company_id: companyId, company_name: company.name_ko, checked, changed, embedded, remaining: left.length, provider });
  } catch (error) {
    console.error("[REDATE_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: "redate_failed", company_id: companyId, message: error.message });
  }
}

async function handleRequest(request, response) {''', 'runRedate')

s = swap(s,
         '  const backfillCompanyId = String(request.query?.backfill || request.body?.backfill || "").trim();',
         '  const redateCompanyId = String(request.query?.redate || request.body?.redate || "").trim();\n'
         '  if (redateCompanyId) return runRedate(response, redateCompanyId);\n'
         '  const backfillCompanyId = String(request.query?.backfill || request.body?.backfill || "").trim();',
         '분기')
save(p, s)
print('ingest-rss ok')


# ── 화면: 정밀도 표시 + 재확인 버튼 ───────────────────────────────
p = 'app/index.html'
s = load(p)
s = swap(s,
         '<button id="digest-all" class="secondary-button" type="button">전체 기업 요약</button>',
         '<button id="digest-all" class="secondary-button" type="button">전체 기업 요약</button>\n'
         '            <button id="redate-all" class="secondary-button" type="button">시점 재확인</button>',
         '버튼')
s = swap(s, 'app.js?v=20260902-compare-pdf', 'app.js?v=20260902-precision', '캐시')
save(p, s)
print('index.html ok')

p = 'app/app.js'
s = load(p)

# 이벤트 매핑에 정밀도를 싣는다.
s = swap(s, "    date: String(event.occurred_at || '').slice(0, 10),",
         "    date: String(event.occurred_at || '').slice(0, 10),\n"
         "    precision: event.occurred_precision || 'day',\n"
         "    dateBasis: event.occurred_basis || '',",
         '이벤트 매핑')

s = swap(s, "function periodOf(", '''// 연간 집계를 특정 하루의 일처럼 보여주면 안 된다. 날짜를 믿을 수 있는 데까지만 적는다.
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
  return event.dateBasis ? `시점 정밀도: ${label}\\n근거: ${event.dateBasis}` : `시점 정밀도: ${label}`;
}

function periodOf(''', 'displayDate')

# 시점 재확인 실행
s = swap(s, "\\nasync function renderComparison(){", '''
// 저장된 연차보고서 이벤트의 시점을 회사마다 다시 확인한다.
// 한 번에 20건씩 처리하므로 남은 건수가 0이 될 때까지 같은 회사를 반복해서 부른다.
async function redateAllCompanies(){
  const targets = companyCatalog.map(company => company.id);
  if (!targets.length) return;
  if (!window.confirm(`추적 ${targets.length}개사의 연차보고서 이벤트 시점을 다시 확인합니다.
기간 집계는 그대로 두고 시점 사건만 웹 검색으로 실제 시기를 찾습니다.
수십 분이 걸리고 그만큼 LLM 비용이 발생합니다. 진행할까요?`)) return;
  const button = document.querySelector('#redate-all');
  button.disabled = true;
  showBusy('이벤트 시점 재확인', `0/${targets.length}`);
  let checked = 0, changed = 0;
  const failed = [];
  try {
    for (const [index, id] of targets.entries()) {
      for (let pass = 0; pass < 6; pass += 1) {
        updateBusy(`${index + 1}/${targets.length} · ${displayName(id)} · 확인 ${checked}건 / 수정 ${changed}건`);
        let result;
        try {
          const response = await fetch(`/api/ingest-rss?redate=${encodeURIComponent(id)}`, { method: 'POST' });
          result = await response.json();
          if (result.status !== 'ok') throw new Error(result.message || result.status);
        } catch (error) { failed.push(displayName(id)); break; }
        checked += result.checked || 0;
        changed += result.changed || 0;
        if (!result.checked || !result.remaining) break;
      }
      companyTimelineCache.delete(id);
    }
  } finally {
    hideBusy();
    button.disabled = false;
  }
  window.alert(`시점 재확인 완료: ${checked}건 확인 / ${changed}건 수정${failed.length ? `\\n실패: ${failed.join(', ')}` : ''}`);
  await renderCompany();
  await renderComparison();
}

async function renderComparison(){''', '재확인 함수')

s = swap(s, "  document.querySelector('#digest-all').addEventListener('click', digestAllCompanies);",
         "  document.querySelector('#digest-all').addEventListener('click', digestAllCompanies);\n"
         "  document.querySelector('#redate-all').addEventListener('click', redateAllCompanies);",
         '핸들러')
save(p, s)
print('app.js ok')
