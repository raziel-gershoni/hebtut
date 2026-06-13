-- Cut student-media storage over to Cloudflare R2 (private bucket + presigned
-- URLs, zero egress).
--
-- We deliberately do NOT null storage_path here. The OLD Supabase store-media
-- cron is still live during the deploy build window and watches
-- `storage_path IS NULL`; nulling now would let it re-store rows back into
-- Supabase before the R2 build goes live, stranding them on keys R2 can't serve.
-- Instead add an `r2_migrated` flag the old cron ignores: existing file-bearing
-- rows default to false, so the NEW cron re-fetches each from Telegram
-- (permanent file_id), uploads into R2, overwrites storage_path with the R2 key,
-- and sets r2_migrated=true. Un-migrated rows fall back to the /api/media proxy
-- in the meantime. The orphaned Supabase objects can be deleted later.
alter table public.messages
  add column if not exists r2_migrated boolean not null default false;
