-- Capture the TG message_id of the transcript follow-up so the
-- /api/messages/[id]/transcript edit endpoint can call editMessageText
-- on the student's chat. Fallback to a "Поправка: ..." follow-up if TG
-- refuses (48h edit cap), in which case the column updates to the new id.

alter table public.messages drop constraint messages_transcript_only_outbound_audio;

alter table public.messages add column transcript_tg_message_id bigint;

alter table public.messages
  add constraint messages_transcript_only_outbound_audio
  check (
    (transcript_text is null and transcript_tg_message_id is null)
    or (direction = 'out' and kind in ('voice', 'video_note'))
  );

-- Default-on for the new admin toggle. Existing deploys that already
-- enabled transcription via the GEMINI_API_KEY env stay on; the admin
-- can flip it via the settings panel without redeploying.
insert into public.app_settings (key, value)
values ('transcripts_enabled', 'true'::jsonb)
on conflict (key) do nothing;
