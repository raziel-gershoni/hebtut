-- Onboarding videos are now sent as TG video_notes (round previews),
-- not regular videos. The cached tg_file_id columns hold IDs returned
-- from `bot.api.sendVideo` calls — those IDs are NOT interchangeable
-- with sendVideoNote (Telegram distinguishes media types). Null them so
-- the next bot send re-captures a fresh video_note file_id via the
-- bytes-still-on-Supabase code path.

update public.onboarding_videos
set tg_file_id = null,
    tg_file_unique_id = null;
