-- 2026-09-07: 정기보고서 전문 임베딩 진행 기록.
-- 큰 보고서는 한 훅(60초)에 다 넣지 못해 여러 훅에 나눠 넣는다. 어디까지 넣었는지 장부에 적는다.
-- embedded_total이 null이면 아직 시작하지 않은 것, embedded_chunks < embedded_total이면 진행 중이다.
-- 재실행 가능.
alter table public.report_digest add column if not exists embedded_chunks int;
alter table public.report_digest add column if not exists embedded_total int;
