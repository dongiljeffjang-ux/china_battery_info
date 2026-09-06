create table if not exists public.ingestion_guard (
  key text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.ingestion_guard enable row level security;
revoke all on public.ingestion_guard from anon, authenticated;
grant select, insert, update, delete on public.ingestion_guard to service_role;
