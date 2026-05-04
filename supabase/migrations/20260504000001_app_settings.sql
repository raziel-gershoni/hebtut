-- Global key/value settings for runtime-toggleable behavior. The first
-- consumer is `quota_chat_notifications_enabled`: when false, the bot
-- suppresses every quota-related chat reply (over-limit rejection,
-- post-send "remaining X" confirmation, /start greeting). The student's
-- daily usage is still visible — just on the Mini App home card instead
-- of in chat. Quota itself is still enforced server-side.
--
-- Generic key/value shape so future toggles drop in without another
-- migration. Reads/writes go exclusively through the service-role key
-- (Next.js routes); RLS denies anon entirely.

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by bigint references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Seed: take the chat copy offline by default. Admins can flip it back
-- on from the admin panel after the dashboard card is in place.
insert into public.app_settings (key, value)
values ('quota_chat_notifications_enabled', 'false'::jsonb);

alter table public.app_settings enable row level security;
