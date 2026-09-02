-- China Battery Lens: 이벤트에 발생 법인을 기록한다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 하나의 기사가 모회사와 여러 계열사를 함께 언급할 수 있으므로 배열로 저장한다.
-- 값은 lib/company-groups.js에 등록된 계열사의 중문(없으면 영문) 법인명이며,
-- 서버가 등록된 별칭으로 매칭해 채운다. 매칭이 없으면 빈 배열이고 화면은 모회사만 표시한다.

alter table public.event
  add column if not exists entity_names text[] not null default '{}';

comment on column public.event.entity_names is
  '이벤트가 발생한 그룹 계열사 법인명. 빈 배열은 모회사 사실이거나 계열사 매칭이 없음을 뜻한다.';

create index if not exists event_entity_names_idx on public.event using gin (entity_names);
