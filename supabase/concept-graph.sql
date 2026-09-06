-- China Battery Lens: 이벤트 문장 안 개념어 사이의 관계(지식그래프).
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- event_fact가 "회사 ↔ 상대방" 비즈니스 관계(고객·합작·거점)를 담는다면, 이 테이블은
-- 그 안에 등장하는 개념어끼리의 관계를 담는다. 예: "실리콘 음극재" -improves-> "에너지밀도",
-- "전고체" -requires-> "황화물 전해질". 회사·상대방명은 여기 넣지 않는다(중복 개념이므로
-- event_fact.counterparty를 그대로 쓴다).
--
-- 신뢰성은 event_fact와 같은 방식으로 모델이 아니라 저장 전 검사로 지킨다.
--   1) excerpt는 이벤트 원문에 글자 그대로 있어야 한다.
--   2) subject/object 원문 표기는 그 excerpt 안에 글자 그대로 있어야 한다.
--   3) predicate·subject_kind·object_kind는 닫힌 목록이다.
-- 그래서 모델이 존재하지 않는 개념이나 관계를 지어내도 화면·리포트에 올라가지 못한다.

create table if not exists public.concept_edge (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event(id) on delete cascade,
  company_id text not null references public.company(id),
  occurred_at date not null,
  -- 이 사실이 속한 시계열 레이어. compare-report의 trajectory 축과 그대로 맞추기 위함이다.
  layer_key text check (layer_key in (
    'supply-performance','investment-production','customer-commercialization','regional-overseas',
    'technology-material-chemistry','technology-process-performance','technology-ip-standard','technology-development'
  )),
  subject text not null,
  subject_original text not null,
  subject_kind text not null check (subject_kind in ('material','process','spec','product','application','standard')),
  predicate text not null check (predicate in (
    'uses','improves','degrades','replaces','requires','enables','achieves','certified_by','competes_with','part_of','derived_from','other'
  )),
  object text not null,
  object_original text not null,
  object_kind text not null check (object_kind in ('material','process','spec','product','application','standard')),
  -- 관계에 붙는 수치가 있으면 원문 표기 그대로(예: "355mAh/g", "+12%"). 없으면 null.
  value_text text,
  excerpt text not null,
  extractor text,
  extracted_at timestamptz not null default now()
);

create index if not exists concept_edge_company_idx on public.concept_edge (company_id, occurred_at desc);
create index if not exists concept_edge_subject_idx on public.concept_edge (subject, subject_kind);
create index if not exists concept_edge_object_idx on public.concept_edge (object, object_kind);
create index if not exists concept_edge_event_idx on public.concept_edge (event_id);

comment on table public.concept_edge is '이벤트 문장에서 뽑은 개념어 사이의 관계(주어-관계-목적어). 원문 표기만, 발췌로 근거를 남긴다.';
comment on column public.concept_edge.subject is '정규화된 개념 표기(별칭 통일 후). 원문 표기는 subject_original.';

-- 같은 개념을 다른 말로 부르는 문제(별칭)를 잡는 작은 사전. 수동으로 채운다 —
-- 모델이 정규화 규칙을 스스로 만들게 하면 표기가 계속 갈라진다.
create table if not exists public.concept_alias (
  alias text primary key,
  canonical text not null,
  kind text not null check (kind in ('material','process','spec','product','application','standard'))
);

comment on table public.concept_alias is '개념어 별칭 → 정규 표기 사전. concept-graph.js가 저장 전에 조회한다.';

-- 추출을 시도한 이벤트 표시. 관계가 0건이어도 다시 뽑지 않게 한다.
alter table public.event add column if not exists concepts_extracted_at timestamptz;
create index if not exists event_concepts_pending_idx on public.event (concepts_extracted_at) where concepts_extracted_at is null;

-- 서버 키만 읽고 쓴다. 다른 테이블과 같은 방식(RLS 켜고 service_role에만 권한).
alter table public.concept_edge enable row level security;
grant select, insert, update, delete on public.concept_edge to service_role;
alter table public.concept_alias enable row level security;
grant select, insert, update, delete on public.concept_alias to service_role;
