-- PDF 텍스트 추출이 이미지 도표를 포함하지 못한다는 품질 상태와 의심 페이지를 기록한다.
-- 재실행 가능. 기존 보고서와 청크는 삭제하지 않는다.
alter table public.report_digest add column if not exists parse_quality text not null default 'text_only';
alter table public.report_digest add column if not exists visual_pages integer[] not null default '{}';

alter table public.report_digest drop constraint if exists report_digest_parse_quality_check;
alter table public.report_digest add constraint report_digest_parse_quality_check
  check (parse_quality in ('text_only', 'visual_review_required', 'visual_checked'));

update public.report_digest
set parse_quality = 'text_only'
where parse_quality is null;

comment on column public.report_digest.parse_quality is
  'text_only: 텍스트 레이어만 추출, visual_review_required: 큰 이미지 페이지 탐지, visual_checked: 이미지 도표 별도 확인 완료';
comment on column public.report_digest.visual_pages is
  'pdfjs 연산 목록에서 페이지 면적의 10% 이상 이미지가 탐지된 1-based 페이지 번호';
