-- Store video dimensions so the library send path can hand them to TG's
-- sendVideo. Without explicit width/height TG defaults the preview to
-- 320×320 (squished/letterboxed regardless of source aspect ratio), and
-- a cached tg_file_id baked from a square send keeps repeating the
-- problem on every subsequent send.

alter table public.media_library
  add column width integer,
  add column height integer;

-- Force every video item to re-ingest on its next send so TG produces a
-- new file_id using the explicit width/height hints. Photo/audio rows
-- don't need this — their preview rendering isn't aspect-ratio sensitive
-- — but null'ing them all is harmless (one extra multipart on first
-- send each, then cached again).
update public.media_library
   set tg_file_id = null,
       tg_file_unique_id = null
 where tg_file_id is not null;
