-- 기업 비교 리포트 히스토리.
-- "비교 리포트 생성" 버튼을 누를 때마다 만들어지는 리포트는 지금까지 브라우저 메모리에만
-- 있다가 새로고침하면 사라졌다. 언제, 어떤 두 회사를 비교했는지와 그 결과를 남겨
-- 나중에 다시 열어볼 수 있게 한다. 재실행해도 안전하도록 IF NOT EXISTS를 쓴다.
create table if not exists compare_report_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_a_id text not null references company(id),
  company_b_id text not null references company(id),
  company_a_name_ko text not null,
  company_b_name_ko text not null,
  events_a_count int not null default 0,
  events_b_count int not null default 0,
  report jsonb not null,
  model text,
  verification_status text,
  searched_sources jsonb
);

create index if not exists compare_report_history_created_at_idx
  on compare_report_history (created_at desc);

-- 리포트 생성 시 "보조 데이터 포함" 토글 상태. 켜져 있으면 참고(reference) 등급
-- 이벤트까지 근거로 LLM에 들어갔다는 뜻이라, 나중에 리포트를 볼 때 근거 범위를 구분한다.
alter table compare_report_history add column if not exists include_supporting boolean not null default false;

-- 이 테이블은 만들어질 때 service_role 권한을 못 받아, API가 저장도 조회도 403으로
-- 거절당했다(42501 permission denied). 화면에는 "히스토리 없음"으로만 보여 한동안
-- 원인을 찾지 못했다. event·daily_report 등 다른 테이블과 같은 권한으로 맞춘다.
-- GRANT는 여러 번 실행해도 결과가 같다.
grant select, insert, update, delete on public.compare_report_history to service_role;
