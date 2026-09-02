-- China Battery Lens: 원문 보관 + 청크 임베딩 파이프라인용 1회 마이그레이션.
-- Supabase SQL Editor에서 실행한다.

alter table public.article
  add column if not exists body_original text,
  add column if not exists body_fetched_at timestamptz,
  add column if not exists embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'embedded', 'failed')),
  add column if not exists embedded_at timestamptz;

alter table public.knowledge_chunk
  add column if not exists content_original text,
  add column if not exists chunk_index smallint,
  add column if not exists chunk_total smallint;

alter table public.knowledge_chunk drop constraint if exists knowledge_chunk_source_type_check;
alter table public.knowledge_chunk add constraint knowledge_chunk_source_type_check
  check (source_type in ('official_document', 'article_fact', 'article_chunk', 'event_fact'));

create index if not exists article_embedding_retry_idx
  on public.article (embedding_status, published_at desc)
  where body_original is not null;

revoke all on public.knowledge_chunk from anon, authenticated;
grant select, insert, update, delete on public.knowledge_chunk to service_role;
