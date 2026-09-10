-- 다른 근거 병기. 재실행해도 안전하다.
--
-- 비교 리포트 웹 검증이 우리 수치·사실과 다른 출처를 찾으면 원래 값(report_metric·event)을 덮어쓰지
-- 않고 여기에 "다른 근거"로 붙인다. 화면은 원래 값 아래에 함께 보여 주고, 이후 리포트 입력에도
-- 상충 근거로 넣는다. 검증기는 리포트 생성 중 한 번 검색하는 단계라, 1차 추출·교차검증을 거친
-- 원래 값보다 검증 수준이 낮다. 2026-09-10 후난위넝 사례에서 검증기는 2025년 연간 생산량을
-- 2026년 상반기 값으로 착각한 것으로 보였다 — 덮어썼다면 맞는 값을 틀린 값으로 바꿨을 것이다.

create table if not exists public.evidence_alternative (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.company(id) on delete cascade,
  target_kind text not null check (target_kind in ('metric', 'event')),
  event_id uuid references public.event(id) on delete cascade,
  period text,                              -- target_kind='metric': 2025 / 2025H1 / 2025Q3
  metric text,                              -- target_kind='metric': revenue_total, capacity_cathode_lfp ...
  original_ko text,                         -- 검증기가 본 우리 쪽 서술
  claim_ko text not null,                   -- 다른 근거가 말하는 내용
  reason_ko text,
  source_url text not null,
  origin text not null default 'compare_report_verify',
  origin_note text,                         -- 어느 비교 리포트에서 나왔는지(회사 쌍)
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  constraint evidence_alternative_target check (
    (target_kind = 'event' and event_id is not null)
    or (target_kind = 'metric' and period ~ '^[0-9]{4}(H[12]|Q[1-4])?$' and metric is not null)
  ),
  constraint evidence_alternative_source check (source_url ~ '^https?://')
);

create index if not exists evidence_alternative_company on public.evidence_alternative (company_id, target_kind);
create index if not exists evidence_alternative_event on public.evidence_alternative (event_id);

alter table public.evidence_alternative enable row level security;
revoke all on public.evidence_alternative from anon, authenticated;
grant select, insert, update, delete on public.evidence_alternative to service_role;
