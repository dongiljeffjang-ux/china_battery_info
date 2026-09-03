-- China Battery Lens: 키워드 연관성 3D 그래프용 벡터 집계.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 키워드·회사·레이어를 벡터 공간의 점으로 만든다. 각 점은 그 개념이 걸린 청크 임베딩의 평균이다.
-- 화면은 이 점들 사이의 코사인 유사도로 연결선을, PCA로 3차원 좌표를 만든다.
create or replace function public.graph_vectors(min_keyword_count int default 2)
returns table(kind text, key text, label text, n bigint, companies text[], centroid vector(1536))
language sql stable as $$
  select 'company', c.id, c.name_ko, count(kc.id), array[c.id],
         avg(kc.embedding)::vector(1536)
  from public.company c
  join public.knowledge_chunk kc on kc.company_id = c.id and kc.embedding is not null
  group by c.id, c.name_ko having count(kc.id) >= 2
  union all
  select 'keyword', k.keyword, k.keyword, count(distinct a.id),
         array_agg(distinct ac.company_id) filter (where ac.company_id is not null),
         avg(kc.embedding)::vector(1536)
  from public.article a
  cross join unnest(a.keywords_ko) k(keyword)
  join public.knowledge_chunk kc on kc.article_id = a.id and kc.embedding is not null
  left join public.article_company ac on ac.article_id = a.id
  where a.verification_status in ('pending_review','approved')
  group by k.keyword having count(distinct a.id) >= min_keyword_count
  union all
  select 'layer', e.layer_key, e.layer_key, count(kc.id),
         array_agg(distinct e.company_id),
         avg(kc.embedding)::vector(1536)
  from public.event e
  join public.knowledge_chunk kc on kc.event_id = e.id and kc.embedding is not null
  where e.layer_key is not null
  group by e.layer_key having count(kc.id) >= 2;
$$;
