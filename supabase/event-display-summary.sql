-- 화면용 요약은 상세 사실(fact_ko)·원문 발췌를 대체하지 않는다.
-- Supabase SQL Editor에서 안전하게 재실행할 수 있다.
alter table public.event add column if not exists display_summary_ko text;
alter table public.event add column if not exists display_summary_model text;
alter table public.event add column if not exists display_summarized_at timestamptz;

create index if not exists event_display_summary_pending_idx
  on public.event (occurred_at desc, id)
  where display_summary_ko is null
    and evidence_kind in ('annual_report', 'periodic_report');
