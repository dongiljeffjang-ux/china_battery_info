-- 정책–회사 연결 판정 저장. 재실행해도 안전하다.
--
-- 기업 분석·비교 보고서에 중국 정책을 넣을 때, 회사 사건과 연결 경로가 판정된 정책만 넣는다.
-- 판정은 LLM이 회사 사건 전체와 정책 목록을 보고 추론한 것이라 사실이 아니라 해석이다.
-- 그래서 event 표가 아니라 여기에 둔다(정책 일반론을 회사 사실로 저장하지 않는다는 불변조건).
-- 회사당 한 행. 정책 집합이 바뀌거나, 7일이 지나거나, 회사 사건이 5건 이상 늘면 다음 보고서 때 다시 판정한다.
--
-- links 원소 모양:
--   { policy_id, policy_title, policy_date, policy_verification, relation: 'direct'|'indirect',
--     path_ko, basis: [{ event_id, date, title }] }
-- basis는 서버가 입력 사건 번호와 대조해 남긴 것만 들어간다. 근거 사건이 없는 연결은 저장하지 않는다.

create table if not exists public.company_policy_link (
  company_id text primary key references public.company(id) on delete cascade,
  links jsonb not null default '[]'::jsonb,
  policy_hash text not null,
  event_count integer not null default 0,
  model text,
  checked_at timestamptz not null default now()
);

alter table public.company_policy_link enable row level security;
revoke all on public.company_policy_link from anon, authenticated;
grant select, insert, update, delete on public.company_policy_link to service_role;

comment on table public.company_policy_link is '회사별 중국 정책 연결 판정(LLM 추론·해석). 보고서 입력과 기업 화면 정책 표시에 쓴다.';
