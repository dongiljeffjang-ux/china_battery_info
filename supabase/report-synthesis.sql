-- 비교 리포트 히스토리에 "리포트 함의 종합"을 같은 표로 쌓는다.
-- 사용자가 지난 비교 리포트를 여러 건 골라 공통 흐름·갈리는 지점·한국 기업 관점 함의를 뽑은 결과다.
-- 별도 표를 만들지 않는 이유: 화면의 "지난 리포트" 목록 하나에 시간순으로 함께 보이게 하기 위해서다.
-- 재실행 가능.

-- 종류. compare = 두 회사 비교(기존), synthesis = 비교 리포트 여러 건의 함의 종합.
alter table public.compare_report_history add column if not exists kind text not null default 'compare';
alter table public.compare_report_history drop constraint if exists compare_report_history_kind_check;
alter table public.compare_report_history add constraint compare_report_history_kind_check
  check (kind in ('compare', 'synthesis'));

-- 종합의 재료가 된 비교 리포트 id 목록(선택 순서 유지). compare 행은 null.
alter table public.compare_report_history add column if not exists source_history_ids uuid[];
-- 목록에 보여 줄 제목. compare 행은 회사명 조합으로 만들므로 null이어도 된다.
alter table public.compare_report_history add column if not exists title_ko text;

-- 종합 행은 특정 두 회사에 속하지 않는다. 회사 컬럼을 비울 수 있게 한다. 기존 compare 행은 그대로다.
alter table public.compare_report_history alter column company_a_id drop not null;
alter table public.compare_report_history alter column company_b_id drop not null;
alter table public.compare_report_history alter column company_a_name_ko drop not null;
alter table public.compare_report_history alter column company_b_name_ko drop not null;

create index if not exists compare_report_history_kind_created_idx
  on public.compare_report_history (kind, created_at desc);

comment on column public.compare_report_history.kind is 'compare: 두 회사 비교 리포트 / synthesis: 비교 리포트 여러 건의 함의 종합';
comment on column public.compare_report_history.source_history_ids is 'synthesis 행이 재료로 쓴 compare 행 id 목록';
