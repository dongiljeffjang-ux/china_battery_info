-- 핵심 상장사 정기보고서 재수집·재분석 장부. 기존 이벤트와 청크는 삭제하지 않는다.
-- 재실행 가능.
alter table public.report_digest add column if not exists renewed_at timestamptz;
alter table public.report_digest add column if not exists renewal_status text;
alter table public.report_digest add column if not exists renewal_inserted integer not null default 0;
alter table public.report_digest add column if not exists source_sha256 text;

alter table public.report_digest drop constraint if exists report_digest_renewal_status_check;
alter table public.report_digest add constraint report_digest_renewal_status_check
  check (renewal_status is null or renewal_status in ('renewed_text_only', 'visual_review_required', 'failed'));

create index if not exists report_digest_renewal_queue_idx
  on public.report_digest (company_id, published_at desc)
  where renewed_at is null and kind in ('annual', 'semiannual');

comment on column public.report_digest.source_sha256 is '재다운로드한 원본 PDF 바이트의 SHA-256';
comment on column public.report_digest.renewal_status is '텍스트 재분석 완료, 이미지 도표 검토 필요, 또는 실패';
