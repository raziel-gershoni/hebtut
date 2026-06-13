-- Inbound student media (voice / video_note / …) stored once in Supabase and
-- served straight from the CDN, zero Vercel egress. Public bucket mirrors
-- media-library (signed URLs are still broken here — see 20260521000001); UUID
-- paths give enumeration protection. Privacy hardening (private + signed) is a
-- deliberate follow-up once the zero-traffic path is proven.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-media', 'student-media', true,
  -- 50 MB bucket cap; note the real binding limit is TG's getFile DOWNLOAD
  -- ceiling (~20 MB), which the store-media cron's retry cap guards against.
  52428800,
  array[
    'audio/ogg','audio/x-caf',
    'video/mp4','video/quicktime',
    'image/jpeg','image/png','image/webp',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- storage_path NULL = not yet stored (drives the cron work-queue AND the
-- client's proxy fallback). storage_caf_path: voice-only CAF remux for
-- pre-18.4 WebKit. stored_at: observability marker.
alter table public.messages add column if not exists storage_path     text;
alter table public.messages add column if not exists storage_caf_path text;
alter table public.messages add column if not exists stored_at        timestamptz;
-- store_attempts: incremented by the cron on each failed store. The work-queue
-- skips rows past a retry cap so a permanently-unstorable row (e.g. a video_note
-- over TG's ~20 MB getFile ceiling) is abandoned to the proxy fallback instead
-- of sitting at the head of the oldest-first queue and starving the backlog.
alter table public.messages add column if not exists store_attempts integer not null default 0;
