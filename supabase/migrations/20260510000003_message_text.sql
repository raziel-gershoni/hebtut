-- Teachers can now send text messages to students via TG swipe-reply.
-- Strictly one-way: students still send only voice/video. The application
-- gate in /api/webhook on message:text checks sender role + reply-to-prompt
-- match; this CHECK constraint is the second line of defence.
--
-- See: docs/superpowers/plans/2026-05-10-admin-autoplay-text-pairing.md F3.

-- Postgres auto-names a single-column check `<table>_<column>_check`. Drop
-- the existing one and reinstate with 'text' added.
alter table public.messages
  drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('voice', 'video_note', 'text'));

-- file_id is a TG file identifier — only meaningful for media. Text rows
-- have no file. Make it nullable, then enforce the right shape per kind.
alter table public.messages
  alter column file_id drop not null,
  add column text_content text;

alter table public.messages
  add constraint messages_text_or_file check (
    (kind = 'text' and text_content is not null and file_id is null) or
    (kind in ('voice', 'video_note') and file_id is not null and text_content is null)
  );

-- Defense in depth: text rows are ONLY ever direction='out'. The application
-- gate prevents incoming text from ever creating a kind='text' row, but a
-- DB-level check makes the invariant impossible to violate.
alter table public.messages
  add constraint messages_text_only_outbound check (
    kind <> 'text' or direction = 'out'
  );
