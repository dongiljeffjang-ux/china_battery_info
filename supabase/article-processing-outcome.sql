-- China Battery Lens: 본문 처리 실패 사유를 남긴다.
-- Supabase SQL Editor에서 한 번 실행한다. 재실행해도 안전하다.
--
-- 지금까지 본문 처리 결과는 실행 직후 응답에만 있었다. fact_check 탈락 사유는
-- reason_ko로 만들어 놓고 버렸고, body_unavailable과 processing_failed는 기사에
-- 아무 흔적도 남기지 않아 pending으로 되돌아갔다. 그래서 "시도했다 실패한 기사"와
-- "아직 시도한 적 없는 기사"가 구분되지 않았고, 죽은 URL이 다음 실행에서 다시
-- 뽑혀 한 회차에 열 건뿐인 본문 분석 예산을 계속 갉아먹었다.

alter table public.article
  add column if not exists processing_status text,
  add column if not exists processing_note text,
  add column if not exists processed_at timestamptz;

comment on column public.article.processing_status is
  '마지막 본문 처리 결과. ok / body_unavailable / body_too_short / fact_check_rejected / processing_failed';

comment on column public.article.processing_note is
  '그 결과의 사유. fact_check_rejected면 검증자가 남긴 탈락 이유가 그대로 들어간다.';

comment on column public.article.processed_at is
  '마지막 본문 처리 시도 시각. 값이 있으면 한 번이라도 시도했다는 뜻이다.';

create index if not exists article_processing_status_idx
  on public.article (processing_status, processed_at desc);

-- 이미 검증을 통과했거나 탈락한 기사에는 지난 결과를 소급해 채운다.
-- 사유는 남아 있지 않으므로 상태만 채우고 note는 비워 둔다.
update public.article
   set processing_status = 'ok',
       processed_at = coalesce(processed_at, body_fetched_at, updated_at)
 where processing_status is null
   and verification_status in ('verified', 'approved');

update public.article
   set processing_status = 'fact_check_rejected',
       processed_at = coalesce(processed_at, updated_at)
 where processing_status is null
   and source_tier = 'fact_check_rejected';
