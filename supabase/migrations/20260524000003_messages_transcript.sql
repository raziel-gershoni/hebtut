-- Verbatim text transcript of a teacher's voice / video_note reply, written
-- after the audio has been delivered to the student. Auto-populated by the
-- Gemini Flash transcription path in src/server/handlers/teacher-reply.ts.
-- NULL means we haven't transcribed (or transcription failed); we don't
-- distinguish — the UI just renders if present.
--
-- Constrained to outbound voice / video_note so we don't accidentally store
-- transcripts on text-kind rows (which would be meaningless) or inbound
-- student messages (out of scope for this PR).

alter table public.messages add column transcript_text text;

alter table public.messages
  add constraint messages_transcript_only_outbound_audio
  check (
    transcript_text is null
    or (direction = 'out' and kind in ('voice', 'video_note'))
  );
