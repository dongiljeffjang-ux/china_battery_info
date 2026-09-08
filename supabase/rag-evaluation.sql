-- China Battery Lens: 벡터 지식(RAG) 사람 평가 저장소.
-- Supabase SQL Editor에서 실행한다. 재실행해도 안전하다.
--
-- 왜 별도 테이블인가.
--   knowledge_chunk에 평가 컬럼을 붙이면 (1) 검색 결과 평가(질문 × 근거)는 청크 한 행에 담기지
--   않고, (2) 재임베딩·재수집으로 청크가 갈리면 평가가 함께 사라진다. 평가는 청크의 속성이 아니라
--   "누가 언제 무엇을 보고 어떻게 판단했다"는 별개의 기록이다.
--
-- 이 테이블은 파이프라인이 읽지 않는다. 관리자 화면이 쓰고 읽기만 한다.
-- 여기 쌓인 판정으로 자동으로 청크를 지우거나 검색 가중치를 바꾸지 않는다. 사람이 보고 정한다.

create table if not exists public.rag_evaluation (
  id uuid primary key default gen_random_uuid(),

  -- 'chunk'  = 청크 자체의 품질(근거로 쓸 만한가)
  -- 'retrieval' = 특정 질문에 이 근거가 나온 것이 맞는가(검색 정밀도)
  subject_type text not null check (subject_type in ('chunk', 'retrieval')),

  chunk_id uuid not null references public.knowledge_chunk(id) on delete cascade,
  -- 집계할 때 knowledge_chunk를 다시 조인하지 않기 위한 의도적 비정규화.
  -- 원본 청크가 지워져도 이 평가가 무엇에 대한 것이었는지 남는다.
  chunk_source_type text,
  company_id text,

  -- 검색 평가에만 채운다. 질문 문자열은 사람이 읽기 위해, question_key는 같은 질문을
  -- 한 묶음으로 세기 위해 둔다(정규화 질문 + 회사 필터 + 미검증 포함 여부의 해시).
  question text,
  question_key text,
  result_rank smallint check (result_rank is null or (result_rank between 1 and 50)),
  retrieved_by text[],
  similarity real,
  filter_company_id text,
  include_unverified boolean,

  verdict text not null check (verdict in ('good', 'partial', 'bad')),
  issue_tags text[] not null default '{}',
  note text,
  evaluator text not null default 'admin',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 검색 평가는 질문 맥락 없이는 의미가 없다.
  constraint rag_evaluation_retrieval_context
    check (subject_type <> 'retrieval' or (question_key is not null and result_rank is not null))
);

-- 같은 대상을 다시 평가하면 새 행을 쌓지 않고 덮어쓴다(판정은 최신 하나만 유효하다).
-- 부분 유니크 인덱스라 청크 평가와 검색 평가가 서로 막지 않는다.
create unique index if not exists rag_evaluation_chunk_uniq
  on public.rag_evaluation (chunk_id, evaluator)
  where subject_type = 'chunk';

create unique index if not exists rag_evaluation_retrieval_uniq
  on public.rag_evaluation (question_key, chunk_id, evaluator)
  where subject_type = 'retrieval';

create index if not exists rag_evaluation_subject_idx
  on public.rag_evaluation (subject_type, updated_at desc);

create index if not exists rag_evaluation_verdict_idx
  on public.rag_evaluation (subject_type, verdict);

alter table public.rag_evaluation enable row level security;
revoke all on public.rag_evaluation from anon, authenticated;
grant select, insert, update, delete on public.rag_evaluation to service_role;

comment on table public.rag_evaluation is
  '벡터 지식의 사람 평가. 청크 품질과 질문별 검색 정밀도를 나눠 기록한다. 파이프라인은 읽지 않는다.';
comment on column public.rag_evaluation.question_key is
  '정규화한 질문 + 회사 필터 + 미검증 포함 여부의 해시. 같은 질문의 평가를 한 세션으로 묶는다.';
