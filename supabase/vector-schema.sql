-- Apply once in Supabase SQL Editor after supabase/schema.sql.
create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_chunk (
  id uuid primary key default gen_random_uuid(),
  company_id text references public.company(id),
  article_id uuid references public.article(id) on delete cascade,
  event_id uuid references public.event(id) on delete cascade,
  source_type text not null check (source_type in ('official_document', 'article_fact', 'event_fact')),
  source_url text,
  source_name text,
  published_at date,
  original_excerpt text,
  content_ko text not null,
  content_hash text not null unique,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  check (article_id is not null or event_id is not null or source_url is not null)
);

create index if not exists knowledge_chunk_company_date_idx on public.knowledge_chunk (company_id, published_at desc);
create index if not exists knowledge_chunk_embedding_hnsw_idx on public.knowledge_chunk using hnsw (embedding vector_cosine_ops);
alter table public.knowledge_chunk enable row level security;
revoke all on public.knowledge_chunk from anon, authenticated;

create or replace function public.match_knowledge_chunks(query_embedding extensions.vector(1536), match_count integer default 8, filter_company_id text default null)
returns table (id uuid, company_id text, article_id uuid, event_id uuid, source_type text, source_url text, source_name text, published_at date, original_excerpt text, content_ko text, similarity double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select k.id, k.company_id, k.article_id, k.event_id, k.source_type, k.source_url, k.source_name, k.published_at, k.original_excerpt, k.content_ko, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunk k
  where k.embedding is not null and (filter_company_id is null or k.company_id = filter_company_id)
  order by k.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_knowledge_chunks(extensions.vector, integer, text) from public, anon, authenticated;
