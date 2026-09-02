-- China Battery Lens: 이벤트의 근거 종류를 구분한다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
--   article       뉴스 기사 본문을 정독·교차검증해 만든 이벤트 (기존 파이프라인)
--   web_backfill  과거 웹 검색으로 채운 보조 이벤트
--   annual_report  연차보고서 원문을 읽어 간추린 핵심 사실 (과거 백필)
--   periodic_report 반기·분기 보고서 원문을 읽어 간추린 핵심 사실 (현행 수집)
--
-- 기존 행은 모두 파이프라인 산출물이므로 article로 채운다.
-- 기업 시계열은 공시 기반(annual_report, periodic_report)과 핵심 등급 기사만 기본 표시하고,
-- web_backfill과 참고 등급 기사는 '보조 데이터 포함'을 켤 때만 나온다.

alter table public.event
  add column if not exists evidence_kind text not null default 'article';

alter table public.event
  drop constraint if exists event_evidence_kind_check;

alter table public.event
  add constraint event_evidence_kind_check
  check (evidence_kind in ('article', 'web_backfill', 'annual_report', 'periodic_report'));

comment on column public.event.evidence_kind is
  '이벤트 근거의 종류. article=기사 정독, web_backfill=과거 웹 검색(보조), annual_report=연차보고서 원문 요약, periodic_report=반기·분기 보고서 원문 요약.';

create index if not exists event_evidence_kind_idx
  on public.event (company_id, evidence_kind, occurred_at);
