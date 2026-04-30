-- Peer-anonymity layer:
--   tg_username      — the public TG handle (admin-only signal alongside tg_user_id).
--   display_handle   — adjective+animal pseudonym shown to peers in chat surfaces.
--   display_emoji    — animal emoji used as the generated avatar in chat surfaces.
--
-- All three are nullable so the migration is forward-compatible. Bot insert
-- paths populate them eagerly for new users; admin /api/users lazily fills
-- legacy NULLs the first time the panel is opened post-deploy.

alter table public.users
  add column if not exists tg_username text,
  add column if not exists display_handle text,
  add column if not exists display_emoji text;

create index if not exists users_tg_username_idx on public.users (tg_username);
create index if not exists users_display_handle_idx on public.users (display_handle);
