-- China Battery Lens: 읽은 정기보고서 장부.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 사람이 버튼을 누르지 않아도 수집 파이프라인의 유지 단계가 "아직 안 읽은 보고서"를 골라
-- 읽을 수 있어야 한다. 같은 보고서를 다시 읽어 LLM 비용을 쓰지 않도록 회사·보고서 URL을 키로 둔다.
-- report_url이 missing:으로 시작하면 그 시기에 보고서를 찾지 못했거나 읽기에 실패했다는 기록이다.

create table if not exists public.report_digest (
  company_id text not null references public.company(id) on delete cascade,
  kind text not null check (kind in ('annual','semiannual','quarterly','web')),
  report_url text not null,
  report_title text,
  published_at date,
  events_inserted integer not null default 0,
  digested_at timestamptz not null default now(),
  primary key (company_id, report_url)
);

create index if not exists report_digest_company_kind_idx
  on public.report_digest (company_id, kind, published_at desc);

comment on table public.report_digest is
  '읽은 정기보고서 장부. report_url이 missing:으로 시작하면 그 시기에 보고서를 찾지 못했다는 기록이다.';

-- 이미 이벤트로 들어온 연차보고서는 읽은 것으로 소급 기록한다.
insert into public.report_digest (company_id, kind, report_url, report_title, events_inserted, digested_at)
select company_id, 'annual', source_url, min(source_name), count(*), min(created_at)
from public.event
where evidence_kind = 'annual_report' and source_url is not null
group by company_id, source_url
on conflict do nothing;


-- 비상장사 웹 백필 기록도 같은 장부에 둔다.
alter table public.report_digest drop constraint if exists report_digest_kind_check;
alter table public.report_digest add constraint report_digest_kind_check
  check (kind in ('annual','semiannual','quarterly','web'));
