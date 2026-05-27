-- Re-ingest every media-library item on its next send. The cached
-- tg_file_id from earlier sends encodes TG's old per-file rendition
-- metadata — including the 320×320 square preview TG produced for
-- videos sent without supports_streaming / duration hints. Nulling
-- both fields forces media-relay.ts to forward the bytes again, this
-- time with the correct hints, and re-cache the new file_id from
-- TG's response.

update public.media_library
   set tg_file_id = null,
       tg_file_unique_id = null
 where tg_file_id is not null;
