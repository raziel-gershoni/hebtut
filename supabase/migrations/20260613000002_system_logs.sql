-- Free-tier stand-in for Vercel logs: structured rows we can read from the
-- admin panel. Generic, but only the store-media feature writes to it for now.
-- Pruned to 14 days by the store-media cron so it can't grow unbounded.
create table public.system_logs (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  level      text not null check (level in ('info','warn','error')),
  source     text not null,
  message    text not null,
  meta       jsonb not null default '{}'::jsonb
);
create index system_logs_created_at_idx on public.system_logs (created_at desc);
create index system_logs_source_idx     on public.system_logs (source, created_at desc);
alter table public.system_logs enable row level security; -- service-role only, anon denied
