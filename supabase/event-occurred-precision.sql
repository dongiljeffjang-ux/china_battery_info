-- China Battery Lens: 이벤트 시점에 정밀도를 붙인다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 연차보고서에서 뽑은 사실은 두 종류가 섞여 있다.
--   기간 집계: "2025년 판매량 60만톤", "보고기간 말 생산능력 78.25만톤" → 보고 기간 말일이 맞다.
--   시점 사건: "인도네시아 2기 투산", "2세대 블레이드 배터리 출시" → 실제 일어난 날이 따로 있다.
-- 처음 적재할 때 둘 다 보고 기간 말일로 들어가서 125건 중 113건이 2025-12-31에 몰렸다.
-- 시점 사건은 날짜가 틀렸고, 연간 집계마저 화면에서는 특정 하루의 일처럼 보였다.

alter table public.event
  add column if not exists occurred_precision text not null default 'day',
  add column if not exists occurred_basis text;

alter table public.event drop constraint if exists event_occurred_precision_check;
alter table public.event add constraint event_occurred_precision_check
  check (occurred_precision in ('day', 'month', 'half', 'year'));

comment on column public.event.occurred_precision is
  'occurred_at을 어디까지 믿을 수 있는지. day=그 날 일어남, month=그 달, half=그 반기, year=그 해의 기간 집계';

comment on column public.event.occurred_basis is
  '그 날짜를 그렇게 정한 근거. 값이 있으면 시점 재확인을 마쳤다는 뜻이기도 하다.';

create index if not exists event_occurred_precision_idx
  on public.event (company_id, occurred_precision, occurred_at desc);

update public.event
   set occurred_precision = 'year',
       occurred_basis = coalesce(occurred_basis, '연차보고서 기간 말일로 일괄 지정됨. 실제 시점 미확인.')
 where evidence_kind = 'annual_report'
   and occurred_at in ('2025-12-31', '2025-06-30', '2024-12-31');
