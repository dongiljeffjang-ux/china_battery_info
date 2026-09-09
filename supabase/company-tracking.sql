-- 관리자 화면의 수집 대상 활성화 설정. 기존 기사·이벤트·임베딩은 지우지 않는다.
create table if not exists public.company_tracking (
  company_id text primary key references public.company(id) on delete restrict,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.company_tracking enable row level security;
revoke all on table public.company_tracking from anon, authenticated;
grant select, insert, update, delete on table public.company_tracking to service_role;

-- 기존의 검증된 기본 대상만 초기 상태로 넣는다. 나머지 마스터 후보는 관리 화면에서 켤 수 있다.
insert into public.company_tracking (company_id, is_active) values
  ('catl', true), ('byd', true), ('eve-energy', true), ('calb', true), ('gotion', true),
  ('sunwoda', true), ('hithium', true), ('rept', true), ('svolt', true), ('farasis', true),
  ('ronbay', true), ('hunan-yuneng', true), ('dynanonic', true), ('xtc-new-energy', true),
  ('easpring', true), ('zhenhua-new-material', true), ('wanrun-new-energy', true), ('lopal', true),
  ('fulin-precision', true), ('reshine', true), ('youshan', true), ('btr', true), ('shanshan', true),
  ('zhongke-electric', true), ('shangtai-technology', true), ('kaijin-new-energy', true)
on conflict (company_id) do nothing;
