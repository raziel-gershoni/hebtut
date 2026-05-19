-- Admin-uploaded videos for the three onboarding video steps. At most three
-- rows ever (one per step). When the row for a step is missing, the bot
-- falls back to the existing text placeholder so onboarding never breaks
-- before admins upload the real clips.
--
-- Bytes live in the existing `media-library` Supabase Storage bucket under
-- the `onboarding/` path prefix — no new bucket, no new RLS surface.

create table public.onboarding_videos (
  step                 text primary key check (step in ('video1','video2','video3')),
  storage_path         text not null unique,
  mime_type            text not null,
  original_filename    text not null,
  bytes                bigint not null check (bytes > 0 and bytes <= 52428800),
  duration_seconds     integer,
  tg_file_id           text,
  tg_file_unique_id    text,
  uploaded_by_user_id  bigint not null references public.users(id) on delete restrict,
  uploaded_at          timestamptz not null default now()
);

-- RLS posture mirrors other application-managed tables — service role only,
-- anon denied. All access mediated by Next.js routes.
alter table public.onboarding_videos enable row level security;
