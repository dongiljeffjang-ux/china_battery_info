-- China Battery Lens: 보고서 추출 진단값을 장부에 남긴다.
-- Supabase SQL Editor에서 실행한다. 재실행해도 안전하다.
--
-- 왜 필요한가. digestReport는 이미 "LLM이 몇 건을 냈고(returned) 검증이 몇 건을 버렸는지(dropped)"를
-- 돌려주는데 아무 데도 저장하지 않았다. pipeline_log는 2026-09-06부터라 보고서 125건 대부분의
-- 추출 기록이 없다. 그래서 2026-09-08 점검에서 완룬 반기보고서가 3건만 낸 이유를
--   (a) LLM이 애초에 안 냈는지
--   (b) 냈는데 날짜 형식 검증에서 버려졌는지
--   (c) 조각 일부가 타임아웃으로 통째로 날아갔는지
-- 구분할 수 없었다. 다음부터는 로그가 아니라 데이터로 남긴다.
--
-- 이 컬럼들은 진단용이다. 파이프라인의 판단(재처리 대상 선정 등)은 events_inserted를 계속 쓴다.

alter table public.report_digest
  -- 원문 전체가 아니라 실제로 LLM에 넣은 구간(MD&A + 重要事项)의 길이.
  -- events_inserted를 이 값으로 나눠야 추출 밀도가 나온다. body_chars로 나누면 분모가 부풀려진다.
  add column if not exists section_chars integer,
  -- section을 몇 조각으로 나눠 몇 번 호출했는지. 조각 수가 늘면 상한(조각당 maxEvents)도 함께 늘어난다.
  add column if not exists digest_chunks smallint,
  -- 실패한 조각 수. 0이 아니면 그 보고서의 결과는 부분이다. 재처리 대상 판단에 쓴다.
  add column if not exists digest_chunks_failed smallint,
  -- LLM이 낸 건수(중복 제거 후). rows와의 차이가 곧 검증이 버린 양이다.
  add column if not exists digest_returned smallint,
  -- occurred_at이 YYYY-MM-DD가 아니어서 버린 건수. 크면 프롬프트가 아니라 정규화가 문제다.
  add column if not exists digest_dropped_bad_date smallint,
  -- title_ko·fact_ko가 비어 버린 건수.
  add column if not exists digest_dropped_empty smallint,
  -- 모델이 낸 원문 발췌가 실제로 입력한 같은 보고서 조각에 연속해서 존재하지 않아 버린 건수.
  -- 표의 다른 행을 섞거나 숫자를 지어낸 후보를 저장 전 차단한다.
  add column if not exists digest_dropped_ungrounded_excerpt smallint,
  -- 그때 쓴 DIGEST_INSTRUCTIONS의 해시 앞 12자. 프롬프트를 고친 뒤 어느 행이 옛 규칙으로
  -- 뽑혔는지 구분해야 재처리 대상을 고를 수 있다.
  add column if not exists digest_prompt_version text;

comment on column public.report_digest.section_chars is
  '실제로 LLM에 넣은 구간의 길이. 추출 밀도의 분모는 body_chars가 아니라 이 값이다.';
comment on column public.report_digest.digest_returned is
  'LLM이 낸 건수(중복 제거 후). events_inserted와의 차이가 검증·중복이 걸러 낸 양이다.';
comment on column public.report_digest.digest_prompt_version is
  'DIGEST_INSTRUCTIONS의 sha256 앞 12자. 프롬프트 변경 전후를 구분해 재처리 대상을 고른다.';

-- 옛 규칙으로 뽑힌 행을 찾는 질의가 자주 나온다.
create index if not exists report_digest_prompt_version_idx
  on public.report_digest (digest_prompt_version, events_inserted);
