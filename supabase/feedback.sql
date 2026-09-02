-- 기존 Supabase 프로젝트에 좋아요/싫어요 기능을 추가할 때 SQL Editor에서 한 번 실행한다.
create table if not exists public.article_feedback (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.article(id) on delete cascade,
  client_key uuid not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, client_key)
);

create index if not exists article_feedback_article_idx on public.article_feedback (article_id, vote);
alter table public.article_feedback enable row level security;
revoke all on public.article_feedback from anon, authenticated;
grant select, insert, update, delete on public.article_feedback to service_role;
