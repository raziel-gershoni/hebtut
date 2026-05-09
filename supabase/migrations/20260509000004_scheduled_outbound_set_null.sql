-- Loosen the FK on scheduled_outbound.original_message_id from CASCADE to
-- SET NULL: if the student deletes the original inbound, a queued teacher
-- reply should still deliver (just un-threaded), not silently disappear.
-- This column is null in practice today (only initiations queue), but the
-- safer cascade matters once we ever queue replies too.

alter table public.scheduled_outbound
  drop constraint scheduled_outbound_original_message_id_fkey;

alter table public.scheduled_outbound
  add constraint scheduled_outbound_original_message_id_fkey
  foreign key (original_message_id) references public.messages(id)
  on delete set null;
