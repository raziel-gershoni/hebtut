-- Migrate onboarding videos to R2 (reusing the media-library R2 bucket). Same
-- flag-gated cutover as media_library: copy job moves existing objects, serving
-- switches to presigned R2 once migrated. No nulling of storage_path.
alter table public.onboarding_videos add column if not exists r2_migrated boolean not null default false;
