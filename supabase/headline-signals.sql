-- China Battery Lens: 헤드라인 신호를 근거와 함께 저장한다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 기존 구현은 keywords_ko(키워드)와 제목 단어 세기(방향)를 따로 만들어 합쳤다.
-- 그 결과 한 기사의 모든 키워드가 기사 하나의 방향을 그대로 물려받아,
-- 공업정보화부 같은 기관명이 확대 신호로 표시됐다.
--
-- headline_signals는 신호 하나마다 방향과 그 판단 근거를 함께 담는다.
--   [{ "keyword_ko": "음극재 증설", "direction": "expansion",
--      "reason_ko": "연 8만톤 신규 라인 가동을 공시해 공급능력이 늘어난다" }]
--
-- direction: expansion | contraction | neutral
-- 비어 있는 기사는 화면이 기존 keywords_ko 방식으로 그린다.

alter table public.article
  add column if not exists headline_signals jsonb not null default '[]'::jsonb;

comment on column public.article.headline_signals is
  '헤드라인 신호 배열. 각 원소는 keyword_ko, direction(expansion/contraction/neutral), reason_ko를 갖는다.';

create index if not exists article_headline_signals_idx
  on public.article using gin (headline_signals);
