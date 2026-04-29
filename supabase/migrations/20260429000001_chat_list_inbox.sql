-- Chat-list inbox: real TG avatars + per-(teacher, student) read state.

-- Avatar caching on users. file_path is short-lived (~1h on TG), so we
-- only cache the file_id; /api/avatar/[id] resolves the path on demand.
alter table public.users
  add column if not exists avatar_file_id text,
  add column if not exists avatar_file_unique_id text,
  add column if not exists avatar_fetched_at timestamptz;

-- Per-(teacher, student) "I last opened this chat at". Powers the
-- unread-count for the chat list. PK on the pair → at most one row
-- per relationship.
create table public.inbox_reads (
  teacher_id    bigint not null references public.users(id) on delete cascade,
  student_id    bigint not null references public.users(id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  primary key (teacher_id, student_id)
);

create index inbox_reads_teacher_idx on public.inbox_reads (teacher_id);

alter table public.inbox_reads enable row level security;

create policy reads_teacher_self on public.inbox_reads
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy reads_admin_read on public.inbox_reads
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);
