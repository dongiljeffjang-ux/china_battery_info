-- China Battery Lens: 정량 조회(T4) 결과를 RAG 평가 판정 대상에 포함한다.
-- Supabase SQL Editor에서 실행한다. 재실행해도 안전하다.
--
-- 무엇이 문제였나 (2026-09-09)
--   근거 검색 화면이 report_metric·market_financial에서 즉석으로 만든 "정량 조회" 청크를
--   내놓기 시작했다(T4). 이 청크는 knowledge_chunk에 저장되지 않는 값이라 id가 실제
--   knowledge_chunk.id가 아닌데, rag_evaluation.chunk_id는 knowledge_chunk를 가리키는
--   외래키였다. 그래서 "CATL 2019년 영업이익" 같은 질문의 정량 결과를 판정하려 하면
--   저장이 invalid_chunk_id로 거절됐다. 사용자 결정: 정량 조회도 판정 대상에 포함한다.
--
-- 왜 knowledge_chunk에 넣지 않고 외래키를 없애는 쪽을 택했나
--   market_financial 값은 article_id·event_id·source_url 중 아무것도 없다(제공자 API
--   집계값이라 원문 문서가 없다). knowledge_chunk는 이 셋 중 하나를 요구하는 무결성
--   체크가 있고, 이걸 지어낸 값으로 통과시키면 "원문 URL을 유지한다"는 이 서비스의
--   불변조건을 우리 스스로 어기게 된다. 대신 chunk_id를 knowledge_chunk를 반드시
--   가리키지 않아도 되는 값으로 완화한다. 정량 청크의 id는 이제 회사·기간·지표·출처를
--   해시한 결정적 UUID다(lib/metric-lookup.js의 metricChunkId) — 같은 칸을 다시 조회해도
--   항상 같은 id가 나오므로, 같은 칸을 재평가하면 새 행을 쌓지 않고 기존 판정을 덮어쓴다.
--
-- 잃는 것
--   knowledge_chunk 행이 지워질 때 그 청크에 대한 평가가 함께 cascade delete 되던 것이
--   없어진다. 실제 청크(article_chunk·event_fact 등)에 대한 평가는 이제 원본이 지워져도
--   고아로 남는다. 이 테이블은 원래 "원본 청크가 지워져도 이 평가가 무엇에 대한 것이었는지
--   남는다"는 의도로 chunk_source_type·company_id를 비정규화해 둔 곳이라(공식 코멘트),
--   방향 자체는 기존 설계와 맞다.
alter table public.rag_evaluation drop constraint if exists rag_evaluation_chunk_id_fkey;

comment on column public.rag_evaluation.chunk_id is
  '판정 대상 식별자. 실제 knowledge_chunk.id이거나(청크 품질·대부분의 검색 정밀도 판정),'
  ' 정량 조회(T4) 결과의 결정적 UUID다(lib/metric-lookup.js metricChunkId). 2026-09-09부터'
  ' knowledge_chunk 외래키가 없다 — 후자가 그 테이블에 존재하지 않기 때문이다.';
