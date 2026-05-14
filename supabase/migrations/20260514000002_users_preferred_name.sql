-- Decouple "name from Telegram" from "name the user/admin chose":
--
-- - `users.name` keeps its current meaning: the Telegram-derived display name
--   re-synced on every /start. Always reflects what TG reports — useful for
--   admin support ("are these the same person?") and for fallback rendering.
-- - `users.preferred_name` is what the student typed in onboarding's
--   awaiting_name step, OR what an admin set via the new
--   /api/admin/users/[id]/preferred-name endpoint. NULL until set; when set,
--   peer-facing surfaces show it instead of the TG name.
--
-- Existing rows: NULL → fallback to `name`. No backfill needed; no behaviour
-- change for users we've never collected a preference from.

alter table public.users
  add column preferred_name text;

create index users_preferred_name_idx
  on public.users (preferred_name)
  where preferred_name is not null;
