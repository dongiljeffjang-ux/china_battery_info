-- 거래소 수시공시(CNINFO)를 본문 분석 대상에 넣으면서 근거 종류를 하나 더 둔다.
--
-- 연차·반기보고서(annual_report/periodic_report)와 달리 수시공시는 정기보고서가 아니지만,
-- 회사가 직접 낸 1차 출처라 언론 기사(article)와도 등급이 다르다. 그래서 disclosure를 따로 둔다.
-- 화면은 이 값을 정기보고서와 같은 핵심 등급으로 보고 '거래소 공시'로 표시한다.
-- 재실행해도 안전하도록 제약을 지우고 다시 만든다.
alter table event drop constraint if exists event_evidence_kind_check;
alter table event add constraint event_evidence_kind_check
  check (evidence_kind = any (array['article', 'web_backfill', 'annual_report', 'periodic_report', 'disclosure']));
