-- China Battery Lens: 미검증 헤드라인을 벡터 지식에 넣기 위한 마이그레이션.
-- Supabase SQL Editor에서 실행한다. 재실행 가능하다.
--
-- 본문 검증(OpenAI 추출 + DeepSeek 교차검증)을 거친 기사만 벡터 DB에 들어가던 것을,
-- 수집만 되고 처리되지 않은 기사의 제목까지 넣도록 넓힌다. 두 등급이 섞이면 안 되므로
-- source_type='headline'으로 구분하고, 질의응답은 기본적으로 이 등급을 제외한다.

-- 1) 헤드라인 등급 허용
alter table public.knowledge_chunk drop constraint if exists knowledge_chunk_source_type_check;
alter table public.knowledge_chunk add constraint knowledge_chunk_source_type_check
  check (source_type in ('official_document', 'article_fact', 'article_chunk', 'event_fact', 'daily_report', 'headline'));

-- 2) 어디까지 번역·임베딩했는지 기사에 표시한다. 다음 훅이 이어받는 지점이다.
alter table public.article
  add column if not exists headline_embedded_at timestamptz;

-- 아직 처리되지 않은 기사 중 헤드라인 임베딩이 남은 것을 찾는 인덱스.
create index if not exists article_headline_embed_idx
  on public.article (published_at desc)
  where verification_status = 'pending' and headline_embedded_at is null;

-- 3) 검색 함수에 미검증 포함 여부를 더한다.
--    기존 3인자 버전을 남겨 두면 이름 있는 인자로 호출할 때 오버로드가 모호해지므로 먼저 지운다.
drop function if exists public.match_knowledge_chunks(extensions.vector, integer, text);
drop function if exists public.match_knowledge_chunks(extensions.vector, integer, text, boolean);

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  filter_company_id text default null,
  include_unverified boolean default false
)
returns table (id uuid, company_id text, article_id uuid, event_id uuid, source_type text, source_url text, source_name text, published_at date, original_excerpt text, content_ko text, similarity double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select k.id, k.company_id, k.article_id, k.event_id, k.source_type, k.source_url, k.source_name, k.published_at, k.original_excerpt, k.content_ko, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunk k
  where k.embedding is not null
    and (filter_company_id is null or k.company_id = filter_company_id)
    -- 미검증 헤드라인은 명시적으로 포함을 요청했을 때만 후보에 넣는다.
    and (include_unverified or k.source_type <> 'headline')
  order by k.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_knowledge_chunks(extensions.vector, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, text, boolean) to service_role;
