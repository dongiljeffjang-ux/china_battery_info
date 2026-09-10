-- China Battery Lens: Supabase SQL Editor에서 한 번 실행한다.
-- 브라우저는 테이블에 직접 접근하지 않고 Vercel API만 호출한다.

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create table if not exists public.company (
  id text primary key,
  name_ko text not null,
  name_zh text,
  name_en text,
  type_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.article (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  source_name text not null,
  title_original text not null,
  title_ko text,
  source_language text,
  published_at timestamptz,
  summary_ko text,
  body_original text,
  body_fetched_at timestamptz,
  embedding_status text not null default 'pending' check (embedding_status in ('pending', 'embedded', 'failed')),
  embedded_at timestamptz,
  keywords_ko text[] not null default '{}',
  verification_status text not null default 'pending',
  source_tier text not null default 'needs_review',
  is_top10 boolean not null default false,
  top10_rank smallint check (top10_rank between 1 and 10),
  timeline_eligibility text not null default 'needs_event_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_top10 = false and top10_rank is null) or (is_top10 = true and top10_rank is not null))
);

create table if not exists public.article_company (
  article_id uuid not null references public.article(id) on delete cascade,
  company_id text not null references public.company(id),
  primary key (article_id, company_id)
);

create table if not exists public.event (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.company(id),
  article_id uuid references public.article(id),
  occurred_at date not null,
  title_ko text not null,
  fact_ko text not null,
  -- 표·카드에서 빠르게 읽는 별도 요약. fact_ko와 원문 발췌는 보존한다.
  display_summary_ko text,
  display_summary_model text,
  display_summarized_at timestamptz,
  trajectory_track text not null check (trajectory_track in ('market', 'technology', 'both')),
  layer_key text,
  region_scope text,
  source_url text,
  source_name text,
  original_excerpt text,
  original_excerpt_ko text,
  timeline_eligibility text not null check (timeline_eligibility in ('core', 'reference', 'exclude')),
  entity_names text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.daily_report (
  report_date date primary key,
  summary_ko text not null,
  model_name text,
  generated_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'approved', 'published'))
);

-- 브라우저별 좋아요/싫어요를 한 건씩 저장한다. 서비스 API만 접근한다.
create table if not exists public.article_feedback (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.article(id) on delete cascade,
  client_key uuid not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, client_key)
);

-- 검증·승인된 지식만 RAG 검색 대상으로 저장한다.
-- 언론 기사 본문 전체는 넣지 않고, 요약·짧은 근거 발췌·공식 문서 청크만 넣는다.
create table if not exists public.knowledge_chunk (
  id uuid primary key default gen_random_uuid(),
  company_id text references public.company(id),
  article_id uuid references public.article(id) on delete cascade,
  event_id uuid references public.event(id) on delete cascade,
  source_type text not null check (source_type in ('official_document', 'article_fact', 'article_chunk', 'event_fact')),
  source_url text,
  source_name text,
  published_at date,
  original_excerpt text,
  content_ko text not null,
  content_original text,
  chunk_index smallint,
  chunk_total smallint,
  content_hash text not null unique,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  check (article_id is not null or event_id is not null or source_url is not null)
);

create index if not exists article_published_at_idx on public.article (published_at desc);
create index if not exists article_top10_idx on public.article (is_top10, top10_rank);
create index if not exists article_embedding_retry_idx on public.article (embedding_status, published_at desc) where body_original is not null;
create index if not exists article_feedback_article_idx on public.article_feedback (article_id, vote);
create index if not exists event_company_date_idx on public.event (company_id, occurred_at);
create index if not exists event_display_summary_pending_idx on public.event (occurred_at desc, id) where display_summary_ko is null;
create index if not exists event_entity_names_idx on public.event using gin (entity_names);
create index if not exists knowledge_chunk_company_date_idx on public.knowledge_chunk (company_id, published_at desc);
create index if not exists knowledge_chunk_embedding_hnsw_idx on public.knowledge_chunk using hnsw (embedding vector_cosine_ops);

alter table public.company enable row level security;
alter table public.article enable row level security;
alter table public.article_company enable row level security;
alter table public.event enable row level security;
alter table public.daily_report enable row level security;
alter table public.article_feedback enable row level security;
alter table public.knowledge_chunk enable row level security;

-- 이미 초기 버전을 실행한 프로젝트에도 근거 열을 추가한다.
alter table public.event add column if not exists source_url text;
alter table public.event add column if not exists source_name text;
alter table public.event add column if not exists original_excerpt text;
alter table public.event add column if not exists original_excerpt_ko text;
alter table public.article add column if not exists keywords_ko text[] not null default '{}';
alter table public.event add column if not exists entity_names text[] not null default '{}';

revoke all on public.company, public.article, public.article_company, public.event, public.daily_report, public.article_feedback from anon, authenticated;
revoke all on public.knowledge_chunk from anon, authenticated;
grant select, insert, update, delete on public.article_feedback to service_role;

-- 검색 RPC는 server-side service_role만 호출한다. 공개 역할에는 실행 권한을 주지 않는다.
create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  filter_company_id text default null
)
returns table (
  id uuid,
  company_id text,
  article_id uuid,
  event_id uuid,
  source_type text,
  source_url text,
  source_name text,
  published_at date,
  original_excerpt text,
  content_ko text,
  similarity double precision
)
language sql stable security invoker set search_path = public, extensions
as $$
  select
    k.id, k.company_id, k.article_id, k.event_id, k.source_type, k.source_url,
    k.source_name, k.published_at, k.original_excerpt, k.content_ko,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunk k
  where k.embedding is not null
    and (filter_company_id is null or k.company_id = filter_company_id)
  order by k.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_knowledge_chunks(extensions.vector, integer, text) from public, anon, authenticated;
