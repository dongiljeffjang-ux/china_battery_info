-- 정기보고서 원문 보관.
--
-- 지금까지 연차·반기보고서는 PDF를 메모리에서 읽어 사실 몇 줄만 뽑고 본문 수십만 자를 버렸다.
-- 226쪽 보고서에서 14줄만 남으니 그 밖의 내용은 다시 볼 수도, 검색할 수도 없었다.
-- 거래소에 공개된 자료라 보관에 문제가 없으므로 원문과 분석 대상 구간을 함께 남긴다.
--   body_original: PDF에서 뽑은 전문
--   body_section : 분석·임베딩에 실제로 쓰는 구간(관리층 논의와 분석 + 중요사항)
--   body_chars   : 전문 길이(진단용)
-- 재실행해도 안전하다.
alter table report_digest add column if not exists body_original text;
alter table report_digest add column if not exists body_section text;
alter table report_digest add column if not exists body_chars int;
