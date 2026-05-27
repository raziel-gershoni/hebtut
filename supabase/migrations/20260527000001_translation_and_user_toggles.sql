-- Translation columns on messages (mirror transcript), under the same
-- CHECK constraint scope (outbound voice/video_note rows only). The
-- previous constraint allowed translation_text only when transcript_text
-- was present; extend it so both pairs follow the same rule.

alter table public.messages drop constraint messages_transcript_only_outbound_audio;

alter table public.messages
  add column translation_text text,
  add column translation_tg_message_id bigint;

alter table public.messages
  add constraint messages_transcript_only_outbound_audio
  check (
    (
      transcript_text is null
      and transcript_tg_message_id is null
      and translation_text is null
      and translation_tg_message_id is null
    )
    or (direction = 'out' and kind in ('voice', 'video_note'))
  );

-- Per-user toggles. Defaults ON so existing students immediately receive
-- both transcripts and translations once the global toggles are on; the
-- admin or the student can flip per row from their respective surfaces.
alter table public.subscriptions
  add column transcripts_enabled boolean not null default true,
  add column translation_enabled boolean not null default true;

-- Global default-on row for translation. Admin can flip via
-- AdminSettingsPanel; effective delivery requires global AND per-user on.
insert into public.app_settings (key, value)
values ('translation_enabled', 'true'::jsonb)
on conflict (key) do nothing;
