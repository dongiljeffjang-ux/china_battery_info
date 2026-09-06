-- China Battery Lens: 관리자 페이지(품질 점검)용 관측 스키마.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 왜 필요한가
--   1) 어느 검색 제공자(OpenAI/DeepSeek)가 찾은 기사인지가 검증 후 source_tier에 덮여 사라졌다.
--      discovered_via에 발견 경로를 따로 남겨 검증 이후에도 출처 경로를 추적한다.
--   2) 수집·처리·Daily·유지 단계의 결과는 Vercel 로그에만 남아 화면에서 볼 수 없었다.
--      pipeline_log에 단계별 결과를 남겨 관리자 페이지가 읽는다.
--   3) 야간 수집 upsert가 이미 검증된 기사를 pending으로 되돌리는 문제가 있었다(코드는 고쳤다).
--      되돌려진 행을 복구한다.

-- 0) headline-knowledge.sql이 아직 운영에 적용되지 않았어도 집계 함수가 만들어지도록 열을 먼저 보장한다.
--    (headline-knowledge.sql의 같은 문장과 동일하며 재실행해도 안전하다.)
alter table public.article add column if not exists headline_embedded_at timestamptz;

-- 1) 발견 경로
alter table public.article add column if not exists discovered_via text;
comment on column public.article.discovered_via is
  '처음 발견한 경로. web_search_openai / web_search_deepseek / web_search_openai+deepseek / cninfo / catl_newsroom / google_news_rss';

update public.article set discovered_via = case
    when source_tier like 'web_search_%' then source_tier
    when source_tier = 'official_disclosure' or source_name = 'CNINFO Disclosure' then 'cninfo'
    when source_name = 'CATL Newsroom' then 'catl_newsroom'
    when source_name = 'Google News RSS' then 'google_news_rss'
    else null end
 where discovered_via is null;

create index if not exists article_discovered_via_idx on public.article (discovered_via, created_at desc);

-- 2) 검증 통과 뒤 재수집 upsert로 pending으로 되돌려진 기사 복구.
--    processing_status='ok'이고 요약이 있으면 검증을 통과한 기사다.
update public.article
   set verification_status = 'pending_review',
       source_tier = case when source_tier like 'web_search_%' or source_tier = 'needs_review' then 'openai_deepseek_fact_checked' else source_tier end
 where processing_status = 'ok'
   and verification_status = 'pending'
   and summary_ko is not null;

-- 3) 파이프라인 단계 로그
create table if not exists public.pipeline_log (
  id bigserial primary key,
  stage text not null,
  hop integer,
  status text not null default 'ok',
  payload jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_log_created_idx on public.pipeline_log (created_at desc);
alter table public.pipeline_log enable row level security;
revoke all on public.pipeline_log from anon, authenticated;
grant select, insert, update, delete on public.pipeline_log to service_role;
grant usage, select on sequence public.pipeline_log_id_seq to service_role;

-- 4) 개요 집계 (PostgREST는 group by를 못 하므로 함수로 둔다)
create or replace function public.admin_overview()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'articles_by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('verification_status', verification_status, 'processing_status', processing_status, 'discovered_via', discovered_via, 'count', c) order by c desc), '[]'::jsonb)
      from (select verification_status, processing_status, discovered_via, count(*) c from public.article group by 1,2,3) s),
    'articles_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'discovered_via', discovered_via, 'count', c) order by d desc), '[]'::jsonb)
      from (select (created_at at time zone 'Asia/Seoul')::date d, discovered_via, count(*) c
              from public.article where created_at > now() - interval '30 days' group by 1,2) s),
    'article_embedding', (
      select coalesce(jsonb_agg(jsonb_build_object('embedding_status', embedding_status, 'count', c)), '[]'::jsonb)
      from (select embedding_status, count(*) c from public.article where body_original is not null group by 1) s),
    'chunks_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('source_type', source_type, 'embedding_model', embedding_model, 'count', c, 'with_vector', v, 'articles', a, 'events', e)), '[]'::jsonb)
      from (select source_type, embedding_model, count(*) c, count(*) filter (where embedding is not null) v,
                   count(distinct article_id) a, count(distinct event_id) e
              from public.knowledge_chunk group by 1,2) s),
    'events', jsonb_build_object(
      'total', (select count(*) from public.event),
      'layer_null', (select count(*) from public.event where layer_key is null),
      'basis_null', (select count(*) from public.event where occurred_basis is null),
      'no_vector', (select count(*) from public.event e where not exists (select 1 from public.knowledge_chunk k where k.event_id = e.id and k.embedding is not null)),
      'by_evidence', (select coalesce(jsonb_agg(jsonb_build_object('evidence_kind', evidence_kind, 'count', c)), '[]'::jsonb)
                      from (select evidence_kind, count(*) c from public.event group by 1) s)
    ),
    'verified_without_chunks', (
      select count(*) from public.article a
       where a.verification_status in ('pending_review','approved')
         and not exists (select 1 from public.knowledge_chunk k where k.article_id = a.id and k.source_type = 'article_chunk')),
    'headline_embedded', (select count(*) from public.article where headline_embedded_at is not null),
    'headline_pending', (select count(*) from public.article where verification_status = 'pending' and headline_embedded_at is null),
    'daily_reports', (select count(*) from public.daily_report where status = 'published'),
    'report_digest', (select count(*) from public.report_digest where report_url not like 'missing:%'),
    'generated_at', now()
  );
$$;
revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
