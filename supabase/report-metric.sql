-- 정기보고서에서 뽑은 정량 지표의 시계열 저장소. 재실행 가능하다.
--
-- event_fact가 아니라 별도 표인 이유: 대시보드 조회는 회사 × 기간 × 지표 피벗 한 번이어야 하는데,
-- event_fact는 이벤트 단위라 매번 조인·중복 제거가 붙는다. 한 칸(company_id, period, metric)에
-- 값은 하나다.
--
-- 불변조건: line_item_zh 없는 행은 만들지 않는다. 원문 계정 이름을 특정하지 못한 숫자는
-- 화면에 올리지 않는다 — 2026-09-08 실측에서 계정 없이 "매출"만 보고 잡으면 CATL 2024·2025년에
-- 해외 매출이 전사 매출 자리에 들어갔다.

create table if not exists report_metric (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references company(id) on delete cascade,
  period text not null,                       -- 2025 / 2025H1 / 2025Q3
  metric text not null,                       -- revenue_total, net_profit_attr, ...
  value numeric not null,
  unit text not null,                         -- CNY_100M(억 위안) 등
  currency text not null default 'CNY',
  line_item_zh text not null,                 -- 원문 계정 표기. 비어 있을 수 없다
  quantity_text text not null,                -- 발췌에 글자 그대로 있는 표기
  yoy_pct_stated numeric,                     -- 원문에 적힌 증감률만. 계산하지 않는다
  excerpt text not null,
  event_id uuid references event(id) on delete cascade,
  report_kind text not null,                  -- annual_report / periodic_report
  source_url text,
  occurred_at date,
  extractor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_metric_period_format check (period ~ '^[0-9]{4}(H[12]|Q[1-4])?$'),
  constraint report_metric_line_item_present check (length(btrim(line_item_zh)) > 0)
);

create unique index if not exists report_metric_cell
  on report_metric (company_id, period, metric);
create index if not exists report_metric_company_metric
  on report_metric (company_id, metric, period);
create index if not exists report_metric_event
  on report_metric (event_id);

create or replace function report_metric_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 없을 때만 만든다. drop 후 재생성하지 않는 이유는 이 파일이 여러 번 실행되기 때문이다 —
-- drop 한 줄이 섞이면 실행할 때마다 "파괴적 작업" 경고가 뜨고, 그 경고를 습관적으로 넘기게 된다.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'report_metric_touch' and not tgisinternal) then
    create trigger report_metric_touch before update on report_metric
      for each row execute function report_metric_touch();
  end if;
end $$;
