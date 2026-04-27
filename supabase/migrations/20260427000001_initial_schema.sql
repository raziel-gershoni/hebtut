-- Users: TG users in a single table with role-based access.
create table public.users (
  id              bigserial primary key,
  tg_user_id      bigint unique not null,
  tg_chat_id      bigint not null,
  name            text,
  role            text not null default 'pending'
                  check (role in ('pending','student','teacher','admin')),
  status          text not null default 'active'
                  check (status in ('active','paused')),
  tz              text not null default 'Asia/Jerusalem',
  created_at      timestamptz not null default now(),
  role_changed_at timestamptz
);

create index users_role_idx on public.users (role);

-- Many-to-many student↔teacher links. Role correctness enforced by trigger.
create table public.student_teachers (
  student_id bigint not null references public.users(id) on delete cascade,
  teacher_id bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, teacher_id)
);

create or replace function public.enforce_link_roles()
returns trigger
language plpgsql
as $$
declare
  s_role text;
  t_role text;
begin
  select role into s_role from public.users where id = new.student_id;
  select role into t_role from public.users where id = new.teacher_id;
  if s_role is null then raise exception 'student % not found', new.student_id; end if;
  if t_role is null then raise exception 'teacher % not found', new.teacher_id; end if;
  if s_role <> 'student' then raise exception 'user % is not a student (role=%)', new.student_id, s_role; end if;
  if t_role <> 'teacher' then raise exception 'user % is not a teacher (role=%)', new.teacher_id, t_role; end if;
  return new;
end;
$$;

create trigger student_teachers_role_check
before insert or update on public.student_teachers
for each row execute function public.enforce_link_roles();

-- Messages: both directions.
create table public.messages (
  id                              bigserial primary key,
  student_id                      bigint not null references public.users(id),
  direction                       text not null check (direction in ('in','out')),
  teacher_id                      bigint references public.users(id),
  kind                            text not null check (kind in ('voice','video_note')),
  file_id                         text not null,
  file_unique_id                  text,
  duration                        int  not null check (duration >= 0),
  status                          text not null check (status in ('pending','claimed','answered','expired','orphaned')),
  claimed_by_teacher_id           bigint references public.users(id),
  claimed_at                      timestamptz,
  answered_at                     timestamptz,
  reply_to_id                     bigint references public.messages(id),
  tg_message_id_in_student_chat   bigint,
  created_at                      timestamptz not null default now()
);

create index messages_student_idx     on public.messages (student_id, created_at desc);
create index messages_status_idx      on public.messages (status) where status in ('pending','claimed');
create index messages_claimed_by_idx  on public.messages (claimed_by_teacher_id) where claimed_by_teacher_id is not null;

-- One row per teacher TG notification for an inbound student message.
create table public.notifications (
  id                          bigserial primary key,
  message_id                  bigint not null references public.messages(id) on delete cascade,
  teacher_id                  bigint not null references public.users(id),
  tg_chat_id                  bigint not null,
  tg_notification_message_id  bigint not null,
  created_at                  timestamptz not null default now()
);

create unique index notifications_unique_idx
  on public.notifications (message_id, teacher_id);

-- One row per "📩 reply to X" prompt sent to a teacher upon claim.
create table public.prompts (
  id                       bigserial primary key,
  teacher_id               bigint not null references public.users(id),
  student_message_id       bigint not null references public.messages(id) on delete cascade,
  tg_chat_id               bigint not null,
  tg_prompt_message_id     bigint not null,
  created_at               timestamptz not null default now()
);

create unique index prompts_unique_idx
  on public.prompts (teacher_id, tg_prompt_message_id);

-- Daily quota usage per student, day in the user's timezone.
create table public.quota_usage (
  student_id    bigint not null references public.users(id) on delete cascade,
  date          date   not null,
  seconds_used  int    not null default 0,
  primary key (student_id, date)
);

-- Realtime publication: opt-in tables that the mini app subscribes to.
alter publication supabase_realtime add table public.messages;
