-- China Battery Lens: RAG 평가세트·실행 이력.
-- RAGAS/무료 검색 지표는 운영 지식 청크를 수정하지 않고 이 세 테이블에만 남긴다.
-- Supabase SQL Editor에서 실행한다. 모든 문장은 재실행 가능하다.

create table if not exists public.rag_eval_case (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  question text not null check (char_length(question) between 1 and 600),
  reference_answer text not null check (char_length(reference_answer) between 1 and 6000),
  reference_chunk_ids uuid[] not null default '{}',
  company_id text,
  include_unverified boolean not null default false,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rag_eval_case_question_scope_uniq
  on public.rag_eval_case (question, coalesce(company_id, ''), include_unverified);
create index if not exists rag_eval_case_active_idx
  on public.rag_eval_case (active, updated_at desc);

create table if not exists public.rag_eval_run (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('retrieval', 'ragas')),
  status text not null default 'completed' check (status in ('queued', 'running', 'completed', 'failed')),
  case_count integer not null default 0 check (case_count >= 0),
  retriever_config jsonb not null default '{}'::jsonb,
  evaluator_config jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  note text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rag_eval_run_finished_idx on public.rag_eval_run (finished_at desc nulls last);

create table if not exists public.rag_eval_result (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rag_eval_run(id) on delete cascade,
  case_id uuid not null references public.rag_eval_case(id) on delete cascade,
  retrieved_chunk_ids uuid[] not null default '{}',
  retrieved_contexts jsonb not null default '[]'::jsonb,
  response text,
  retrieval_metrics jsonb not null default '{}'::jsonb,
  ragas_metrics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (run_id, case_id)
);
create index if not exists rag_eval_result_case_idx on public.rag_eval_result (case_id, created_at desc);

alter table public.rag_eval_case enable row level security;
alter table public.rag_eval_run enable row level security;
alter table public.rag_eval_result enable row level security;
revoke all on public.rag_eval_case from anon, authenticated;
revoke all on public.rag_eval_run from anon, authenticated;
revoke all on public.rag_eval_result from anon, authenticated;
grant select, insert, update, delete on public.rag_eval_case to service_role;
grant select, insert, update, delete on public.rag_eval_run to service_role;
grant select, insert, update, delete on public.rag_eval_result to service_role;

comment on table public.rag_eval_case is '사람이 검토한 RAG 평가 문제지: 질문·기준답변·정답 청크.';
comment on table public.rag_eval_run is '검색 스냅샷 또는 외부 RAGAS 평가의 실행 이력.';
comment on table public.rag_eval_result is '실행별 질문 결과와 검색·RAGAS 점수.';
