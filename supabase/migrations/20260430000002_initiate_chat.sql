-- Teacher-initiated outbound: prompts no longer require a prior student
-- message. Add a denormalized student_id (so every prompt can locate the
-- student without joining through messages) and relax student_message_id
-- to nullable for pure-initiation rows.

alter table public.prompts
  add column if not exists student_id bigint references public.users(id) on delete cascade;

-- Backfill existing rows by joining to the messages table so the new
-- column starts populated for all historical reply prompts.
update public.prompts p
set student_id = m.student_id
from public.messages m
where m.id = p.student_message_id
  and p.student_id is null;

alter table public.prompts alter column student_id set not null;
alter table public.prompts alter column student_message_id drop not null;

create index if not exists prompts_student_idx on public.prompts (student_id);
