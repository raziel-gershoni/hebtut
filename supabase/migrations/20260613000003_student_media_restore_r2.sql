-- Switch student-media storage from Supabase Storage to Cloudflare R2 (private
-- bucket + presigned URLs, zero egress). Existing storage_path values point at
-- Supabase objects that the new R2 presigner can't sign, so null them out —
-- ONLY for inbound student media, never media-library rows — to re-queue them
-- for the store-media cron, which re-fetches from Telegram (permanent file_id)
-- and uploads into R2. The /api/media proxy covers playback during the brief
-- re-store window. The orphaned Supabase objects can be deleted later.
update public.messages
set storage_path = null,
    storage_caf_path = null,
    stored_at = null,
    store_attempts = 0
where storage_path is not null
  and media_library_id is null;
