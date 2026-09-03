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
