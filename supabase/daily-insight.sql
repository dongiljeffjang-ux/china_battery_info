-- China Battery Lens: Daily 리포트에 한국 기업 관점의 해석을 붙이고, 생성 결과를 검색 대상으로 만든다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- summary_ko는 카테고리별 사실만 담는다. insight_ko는 그 사실들이 한국 배터리사·소재사에게
-- 무엇을 뜻하는지에 대한 해석이며, prd.md의 "사실, 해석, 추정을 구분한다" 원칙에 따라
-- 컬럼을 분리해 저장한다. 화면도 두 영역을 나눠 표시한다.

alter table public.daily_report
  add column if not exists insight_ko text;

comment on column public.daily_report.insight_ko is
  '수집된 사실을 근거로 한 한국 배터리사·소재사 관점의 해석. 사실이 아니라 해석이므로 summary_ko와 분리한다.';

-- 생성된 Daily 리포트도 벡터 검색 대상에 넣는다.
-- 한 번 만든 결과를 다시 생성하지 않고 재사용하고, 향후 다른 서비스에서도 쓰기 위함이다.
alter table public.knowledge_chunk
  drop constraint if exists knowledge_chunk_source_type_check;

alter table public.knowledge_chunk
  add constraint knowledge_chunk_source_type_check
  check (source_type in ('official_document', 'article_fact', 'article_chunk', 'event_fact', 'daily_report'));

create index if not exists knowledge_chunk_source_type_idx
  on public.knowledge_chunk (source_type, published_at desc);
