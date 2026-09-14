-- pending 복구 큐: 일시적 원문 fetch 실패만 제한적으로 재시도한다.
-- robots.txt 차단·본문 없음·본문 부족은 이 열과 무관하게 자동 재시도하지 않는다.
alter table public.article
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists next_processing_at timestamptz;

alter table public.article
  drop constraint if exists article_processing_attempts_nonnegative;
alter table public.article
  add constraint article_processing_attempts_nonnegative check (processing_attempts >= 0);

create index if not exists article_pending_recovery_idx
  on public.article (verification_status, processing_status, next_processing_at, published_at desc);

comment on column public.article.processing_attempts is
  '원문 처리 시도 횟수. fetch 실패는 최대 3회만 자동 재시도한다.';
comment on column public.article.next_processing_at is
  'processing_failed 기사를 다시 시도해도 되는 가장 이른 시각. null이면 즉시 가능하거나 자동 재시도 종료 상태다.';
