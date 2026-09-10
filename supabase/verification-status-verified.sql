-- 자동 본문 대조 통과 상태의 이름을 pending_review → verified로 바꾼다. 재실행해도 안전하다.
--
-- pending_review는 "사람 검토 대기"로 읽히지만 실제 뜻은 "OpenAI 추출 + DeepSeek 본문 대조 통과"다.
-- 코드(2026-09-10 배포)는 이미 새 기사를 verified로 쓰고 두 값을 모두 읽는다.
-- 이 파일을 실행한 뒤 코드에서 pending_review 읽기를 뺀다.
--
-- 실행 전 확인용(바뀔 행 수):
--   select verification_status, count(*) from public.article group by 1 order by 2 desc;

update public.article
   set verification_status = 'verified'
 where verification_status = 'pending_review';

-- 관리자 개요 집계. admin-observability.sql의 같은 함수에서 상태 값만 바꿨다.
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
       where a.verification_status in ('verified','approved')
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
