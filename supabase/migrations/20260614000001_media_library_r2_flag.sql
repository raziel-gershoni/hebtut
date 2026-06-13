-- Migrate the admin media-library to R2 (private). r2_migrated drives the copy
-- job and (later) the R2-only serving switch. We do NOT null/move anything here;
-- the copy job reads from Supabase and writes to R2, keeping the Supabase
-- original until an explicit later cleanup (soak window for rollback).
alter table public.media_library add column if not exists r2_migrated boolean not null default false;
