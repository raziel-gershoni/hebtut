-- Reusable media library: tutors upload photos / regular videos / audio
-- files once and re-send them to students from the Mini App thread. Storage
-- is Supabase Storage (canonical bytes) plus a cached TG file_id captured
-- after the first send to any student — every subsequent send to any
-- student is then a single TG-internal reference, no Supabase fetch.
--
-- Tags are admin-managed (flat catalog, no colors). Items carry an
-- optional title + description so peer surfaces show meaningful names.
-- Upload permission is gated by a runtime toggle (default: admin only,
-- can be flipped to admin+teacher from the admin panel).

-- Private bucket; signed URLs only. Service role bypasses RLS, so no
-- bucket policies needed — all access is mediated by Next.js routes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-library',
  'media-library',
  false,
  52428800, -- 50 MB (TG bot API ceiling for send* by URL)
  array[
    'image/jpeg','image/png','image/webp',
    'video/mp4','video/quicktime','video/webm',
    'audio/mpeg','audio/mp4','audio/aac','audio/x-m4a','audio/ogg','audio/wav'
  ]
)
on conflict (id) do nothing;

create type public.media_kind as enum ('photo', 'video', 'audio');

create table public.media_library (
  id                   bigserial primary key,
  kind                 public.media_kind not null,
  uploaded_by_user_id  bigint not null references public.users(id) on delete restrict,
  storage_path         text not null unique,
  mime_type            text not null,
  original_filename    text not null,
  title                text,
  description          text,
  bytes                bigint not null check (bytes > 0 and bytes <= 52428800),
  duration_seconds     integer,
  tg_file_id           text,
  tg_file_unique_id    text,
  created_at           timestamptz not null default now()
);

create index media_library_created_at_idx on public.media_library (created_at desc);
create index media_library_kind_idx       on public.media_library (kind);
create index media_library_uploader_idx   on public.media_library (uploaded_by_user_id);

-- Admin-managed tag catalog. Slugged so lookup-by-name stays fast and
-- case-insensitive (slugify on insert in the API layer).
create table public.media_tags (
  id                  bigserial primary key,
  name                text not null check (length(name) between 1 and 40),
  slug                text not null unique,
  created_by_user_id  bigint not null references public.users(id) on delete restrict,
  created_at          timestamptz not null default now()
);

-- Many-to-many. created_by_user_id records who assigned the tag (uploader
-- or admin — the same permission rule as edit/delete on the item).
create table public.media_library_tag_links (
  media_library_id    bigint not null references public.media_library(id) on delete cascade,
  tag_id              bigint not null references public.media_tags(id) on delete cascade,
  created_by_user_id  bigint not null references public.users(id) on delete restrict,
  created_at          timestamptz not null default now(),
  primary key (media_library_id, tag_id)
);

create index media_library_tag_links_tag_idx on public.media_library_tag_links (tag_id);

-- Runtime toggle: when true, teachers can upload to the library too.
-- Default is false (admin-only uploads). Same key/value + 30s in-process
-- cache plumbing as `display_anonymous_handles_enabled`.
insert into public.app_settings (key, value)
values ('media_uploads_teachers_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- Extend messages.kind to cover the new media types.
alter table public.messages
  drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('voice','video_note','text','photo','video','audio'));

-- Provenance link from a sent message back to its library item. ON DELETE
-- SET NULL because we want historical sends to survive library cleanup:
-- the file_id on the message row is still TG-valid even if the library
-- row is gone, so the bubble keeps rendering.
alter table public.messages
  add column media_library_id bigint references public.media_library(id) on delete set null;

create index messages_media_library_id_idx
  on public.messages (media_library_id)
  where media_library_id is not null;

-- Widen the text-or-file constraint: the new media kinds behave like
-- voice/video_note (file_id present, text_content absent).
alter table public.messages
  drop constraint messages_text_or_file;
alter table public.messages
  add constraint messages_text_or_file check (
    (kind = 'text' and text_content is not null and file_id is null) or
    (kind in ('voice','video_note','photo','video','audio')
       and file_id is not null and text_content is null)
  );

-- RLS: same posture as other application-managed tables — service role
-- only, anon denied. All access mediated by Next.js routes.
alter table public.media_library enable row level security;
alter table public.media_tags enable row level security;
alter table public.media_library_tag_links enable row level security;
