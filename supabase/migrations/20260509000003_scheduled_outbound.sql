-- Queue for teacher-initiated messages held outside the student's
-- response_window. Replies during an active claim still deliver immediately
-- and don't touch this table.
--
-- Drained by /api/cron/deliver-scheduled every minute.

create table public.scheduled_outbound (
  id                   bigserial primary key,
  student_id           bigint not null references public.users(id) on delete cascade,
  teacher_id           bigint not null references public.users(id) on delete cascade,
  kind                 text   not null check (kind in ('voice','video_note')),
  file_id              text   not null,
  duration             int    not null,
  -- Initiation messages have no original (teacher kicks off a fresh thread);
  -- replies don't queue here at all, so this column stays null in practice.
  original_message_id  bigint references public.messages(id) on delete cascade,
  tg_chat_id           bigint not null, -- destination student chat
  deliver_at           timestamptz not null,
  status               text   not null default 'queued'
                              check (status in ('queued','delivered','failed','cancelled')),
  delivered_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index scheduled_outbound_due_idx
  on public.scheduled_outbound (deliver_at)
  where status = 'queued';

create index scheduled_outbound_student_idx
  on public.scheduled_outbound (student_id);

alter table public.scheduled_outbound enable row level security;
