-- Inbound student media (voice / video_note / …) stored once in Supabase and
-- served straight from the CDN, zero Vercel egress. Public bucket mirrors
-- media-library (signed URLs are still broken here — see 20260521000001); UUID
-- paths give enumeration protection. Privacy hardening (private + signed) is a
-- deliberate follow-up once the zero-traffic path is proven.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-media', 'student-media', true,
  52428800, -- 50 MB, TG bot-API file ceiling
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
