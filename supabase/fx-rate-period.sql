-- 회계 기간별 평균 환율. 화면에서 위안화 실적을 달러로도 보여 주기 위한 표시용 계수다.
--
-- 회사가 공시한 사실이 아니다. 그래서 재무 표와 섞지 않고 따로 둔다. 화면은 환산값임을 밝히고
-- 원래 통화(CNY) 값을 함께 보여 준다.
--
-- 왜 "기간 평균"인가. 중국 분기 재무는 누적(YTD)이라 2025Q3는 1~9월 합이다. 그 값을 달러로
-- 보려면 같은 1~9월 구간의 평균이어야 한다. 기말 환율 하나로 누적 매출을 나누면 연중 환율이
-- 움직인 만큼 틀린다. window_start·window_end와 sample_days를 남겨 무엇을 평균했는지 검산한다.

create table if not exists fx_rate_period (
  id uuid primary key default gen_random_uuid(),
  period text not null,                       -- 2025 / 2025H1 / 2025Q1 / 2025Q3
  base text not null default 'USD',
  quote text not null default 'CNY',
  rate_avg numeric not null,                  -- base 1단위당 quote (USD 1 = 7.2 CNY)
  sample_days integer not null,               -- 평균에 쓴 영업일 수
  window_start date not null,
  window_end date not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  constraint fx_rate_period_format check (period ~ '^[0-9]{4}(H[12]|Q[1-4])?$'),
  constraint fx_rate_period_positive check (rate_avg > 0)
);

grant select, insert, update, delete on public.fx_rate_period to service_role;

create unique index if not exists fx_rate_period_cell
  on fx_rate_period (period, base, quote);
