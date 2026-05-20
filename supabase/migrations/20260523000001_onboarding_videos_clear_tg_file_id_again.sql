-- Existing onboarding_videos rows were encoded against the 40 MB
-- generic target, producing files way too big for the bot's Vercel
-- function to fetch + multipart-upload to TG inside the 10 s function
-- timeout. The video_note compression target dropped to 5 MB, but
-- existing files in storage are still huge.
--
-- Null the cached tg_file_id so any old cached IDs (which would point
-- at the big file's video_note representation, if it ever uploaded) are
-- invalidated. After the admin re-uploads through the new pipeline,
-- the file will be small enough for the send to complete in time.

update public.onboarding_videos
set tg_file_id = null,
    tg_file_unique_id = null;
