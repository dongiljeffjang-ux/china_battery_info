-- China Battery Lens: 벡터 지식 검색을 하이브리드(의미 + 단어)로 넓히는 마이그레이션.
-- Supabase SQL Editor에서 실행한다. 재실행 가능하다.
--
-- 왜 필요한가.
--   코사인 검색만으로는 'SW-2413' 같은 모델명·코드, 회사 별칭, 정확한 수치처럼
--   "뜻이 아니라 글자가 같아야" 찾히는 근거를 놓친다. 임베딩은 그런 토큰을 주변 문맥에
--   녹여 버리기 때문이다. 단어 검색을 따로 돌려 후보에 합치면 그 구멍이 메워진다.
--   하이브리드는 후보를 줄이는 장치가 아니라 늘리는 장치다. 순위 융합(RRF)은 애플리케이션이 한다.
--
-- 왜 형태소 분석기가 아니라 PGroonga인가.
--   1. knowledge_chunk.content_ko는 '[한국어 팩트 요약] + [원문 근거 청크]' 구조라
--      한국어와 중국어가 한 필드에 섞여 있다. 한국어 전용 형태소 분석기는 중국어 쪽을 처리하지 못한다.
--      원문을 따로 담는 content_original은 거의 비어 있다(2026-09-08 확인: 1,701행 중 37행, 2.2%).
--      수집이 덜 된 것이 아니라 보관 정책의 결과다. 이 컬럼은 원문을 남기는 거래소 공시 경로에서만
--      채워지고, 언론 기사 경로는 저작권 때문에 null을 넣는다. report_chunk는 아직 0행이다
--      (REPORT_TEXT_ONLY_EMBEDDING=0). 즉 단어 검색이 실제로 훑는 중국어 원문은 이 컬럼이 아니라
--      original_excerpt다(1,701행 중 1,064행, 62.6%).
--   2. 이 검색이 건져야 하는 것은 형태소가 아니라 부서지지 않은 코드·고유명사다.
--   3. PGroonga는 Postgres 안에서 끝나므로 Vercel 함수에 모델을 싣지 않는다(kiwi 모델은 58.7MB다).

-- 1) 확장. Supabase 프로젝트에 3.2.5가 준비돼 있다.
create extension if not exists pgroonga;

-- 2) 검색 대상 텍스트를 한 컬럼으로 모은다.
--    본문(content_ko)만 색인하면 original_excerpt에만 있는 원문 표기를 놓친다.
--    생성 컬럼이라 적재 코드는 손대지 않아도 항상 최신이다.
--    다만 원문 표기의 분포는 등급마다 다르다(2026-09-08 확인). event_fact는 751행 중 724행,
--    headline은 340행 전부에 original_excerpt가 있지만, article_chunk 598행은 0행이다.
--    기사 청크의 단어 검색은 사실상 한국어 번역문만 대상으로 돈다. 코드·모델명은 번역문에도
--    그대로 남아 걸리지만, 한자 표기로만 나오는 표현은 기사 청크에서 걸리지 않는다.
alter table public.knowledge_chunk
  add column if not exists search_text text
  generated always as (
    coalesce(content_ko, '') || ' ' ||
    coalesce(original_excerpt, '') || ' ' ||
    coalesce(content_original, '')
  ) stored;

-- 3) 단어 검색 인덱스.
--    TokenBigramSplitSymbolAlphaDigit은 영숫자와 기호까지 bigram으로 쪼갠다.
--    'NCM811'에서 '811'만 물어도 걸리게 하려는 것이다. 재현율을 정밀도보다 앞에 둔 선택이고,
--    정밀도는 뒤이은 RRF 융합과 프롬프트 상한이 맡는다.
create index if not exists knowledge_chunk_pgroonga_idx
  on public.knowledge_chunk
  using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit');

-- 4) 단어 검색 RPC.
--    query_text는 애플리케이션이 조립한 PGroonga 질의문이다(예: '삼원계 OR 양극재 OR NCM811').
--    사용자 원문을 그대로 넣지 않는다. lib/knowledge-search.js의 buildLexicalQuery()가
--    연산자 문자를 털어내고 조사 변형을 OR로 펼친 뒤 넘긴다.
--    반환 컬럼은 match_knowledge_chunks와 같은 모양으로 맞춘다. 융합 코드가 두 결과를
--    같은 구조로 다룰 수 있어야 한다. similarity 자리에는 pgroonga_score를 넣지 않는다.
--    둘은 척도가 달라 섞으면 안 되고, 순위만 쓰는 RRF에는 점수가 필요 없기 때문이다.
create or replace function public.lexical_knowledge_chunks(
  query_text text,
  match_count integer default 10,
  filter_company_id text default null,
  include_unverified boolean default false
)
returns table (
  id uuid, company_id text, article_id uuid, event_id uuid, source_type text,
  source_url text, source_name text, published_at date, original_excerpt text,
  content_ko text, lexical_score double precision
)
language sql stable security invoker set search_path = public, extensions
as $$
  select k.id, k.company_id, k.article_id, k.event_id, k.source_type,
         k.source_url, k.source_name, k.published_at, k.original_excerpt,
         k.content_ko, pgroonga_score(k.tableoid, k.ctid) as lexical_score
  from public.knowledge_chunk k
  where k.search_text &@~ query_text
    and (filter_company_id is null or k.company_id = filter_company_id)
    -- 미검증 헤드라인 정책은 의미 검색과 동일하게 간다. 한쪽만 열리면 등급이 섞인다.
    and (include_unverified or k.source_type <> 'headline')
  order by pgroonga_score(k.tableoid, k.ctid) desc, k.published_at desc nulls last
  limit least(greatest(match_count, 1), 30);
$$;

revoke all on function public.lexical_knowledge_chunks(text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.lexical_knowledge_chunks(text, integer, text, boolean) to service_role;
