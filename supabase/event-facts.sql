-- China Battery Lens: 이벤트에서 뽑은 구조화 사실(전략 장부).
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 이벤트 한 건("프랑스 Orano 합작 4만 톤 삼원재·4만 톤 전구체 추진")에는 사실이 여러 개 들어 있다.
-- 회사를 가로질러 같은 축(품목·지역·상대방)으로 놓고 보려면 그 사실을 따로 꺼내 두어야 한다.
-- 원문에 적힌 숫자·이름만 담고, 합산·환산·추정은 하지 않는다. 사실마다 근거 발췌를 붙인다.

create table if not exists public.event_fact (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event(id) on delete cascade,
  company_id text not null references public.company(id),
  -- capacity 생산능력 / shipment 출하·판매량 / financial 매출·이익 / customer 고객·수주 /
  -- partnership 합작·제휴 / site 거점(수량 없어도 됨) / spec 기술 스펙
  fact_type text not null check (fact_type in ('capacity','shipment','financial','customer','partnership','site','spec')),
  segment text not null default 'other' check (segment in ('ncm','lfp','precursor','anode','cell','ess','other')),
  item text,
  metric text,
  quantity numeric,
  unit text,
  quantity_text text,
  status text check (status in ('planned','under_construction','operating','completed','suspended','unknown')),
  country text,
  city text,
  counterparty text,
  counterparty_original text,
  counterparty_kind text check (counterparty_kind in ('oem','cell','material','resource','government','other')),
  relation text,
  period text,
  occurred_at date not null,
  excerpt text not null,
  -- disclosure 거래소 공시 / article 기사 / web 웹 검색 백필(참고)
  source_tier text not null check (source_tier in ('disclosure','article','web')),
  extractor text,
  extracted_at timestamptz not null default now(),
  -- single 한 모델 / double 두 모델 일치 / conflict 두 모델 불일치(검토 필요)
  agreement text not null default 'single' check (agreement in ('single','double','conflict')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','confirmed','rejected')),
  reviewed_at timestamptz
);

create index if not exists event_fact_company_idx on public.event_fact (company_id, fact_type, segment, occurred_at desc);
create index if not exists event_fact_event_idx on public.event_fact (event_id);
create index if not exists event_fact_country_idx on public.event_fact (country) where country is not null;
create index if not exists event_fact_counterparty_idx on public.event_fact (counterparty) where counterparty is not null;

comment on table public.event_fact is '이벤트에서 뽑은 구조화 사실. 원문 숫자·이름만, 발췌로 근거를 남긴다.';
comment on column public.event_fact.unit is '표준 단위: t/yr(연 톤), GWh/yr, GWh, t, CNY_100M(억 위안), CNY_10K(만 위안), pct, Wh/kg, mAh/g, C, units';
comment on column public.event_fact.period is '수치가 가리키는 기간. 2024, 2025H1, 2025Q3 같은 표기';

-- 추출을 시도한 이벤트 표시. 사실이 0건이어도 다시 뽑지 않게 한다.
alter table public.event add column if not exists facts_extracted_at timestamptz;
create index if not exists event_facts_pending_idx on public.event (facts_extracted_at) where facts_extracted_at is null;

-- 서버 키만 읽고 쓴다. 다른 테이블과 같은 방식(RLS 켜고 service_role에만 권한).
alter table public.event_fact enable row level security;
grant select, insert, update, delete on public.event_fact to service_role;
