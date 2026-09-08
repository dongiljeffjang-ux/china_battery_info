-- 거래소 재무 데이터(손익계산서 표준 항목)의 시계열 저장소. 재실행 가능하다.
--
-- report_metric과 왜 나누는가. 두 출처는 성격이 다르다.
--   report_metric  : 정기보고서 원문 발췌에서 뽑은 값. 원문 계정 표기·발췌·PDF URL을 갖는다.
--                    대신 요약이 고른 항목만 있어 영업이익은 72 회사-연 중 3칸뿐이었다.
--   market_financial: 데이터 제공자가 정리한 표준 손익 항목. 발췌가 없는 대신 영업이익·扣非까지
--                    분기 단위로 전부 있다.
-- 같은 칸을 두 출처가 채우면 서로 검증이 된다(CATL 2025 귀속순이익 722억이 양쪽에서 일치했다).
-- 그래서 한쪽을 지우지 않고 병존시키고, 화면이 출처를 배지로 밝힌다.
--
-- 불변조건: 금액은 제공자가 준 원값(raw_amount, 元)을 그대로 남기고 value(억 위안)는 그 환산이다.
-- 통화는 환산하지 않는다. 홍콩 상장사는 CURRENCY가 다를 수 있어 그대로 저장한다.

create table if not exists market_financial (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references company(id) on delete cascade,
  security_code text not null,                -- 300750.SZ / 03931.HK
  period text not null,                       -- 2025 / 2025H1 / 2025Q1 / 2025Q3
  report_date date not null,
  metric text not null,                       -- revenue_total, operating_profit, ...
  item_zh text not null,                      -- 营业总收入 / 经营溢利 등 제공자 표준 항목명
  value numeric not null,                     -- 억 위안 등 unit 기준
  unit text not null default 'CNY_100M',
  currency text not null default 'CNY',
  raw_amount numeric not null,                -- 제공자 원값(元). 환산 검산용
  yoy_pct numeric,                            -- 제공자가 준 전년 동기 대비. 우리가 계산하지 않는다
  report_type text,                           -- 年报 / 中报 / 一季报 …
  account_standard text,                      -- 국제회계기준 등 (있을 때만)
  source text not null,                       -- 데이터 출처 식별자
  fetched_at timestamptz not null default now(),
  constraint market_financial_period_format check (period ~ '^[0-9]{4}(H[12]|Q[1-4])?$')
);

grant select, insert, update, delete on public.market_financial to service_role;

create unique index if not exists market_financial_cell
  on market_financial (company_id, period, metric);
create index if not exists market_financial_company_metric
  on market_financial (company_id, metric, report_date);
