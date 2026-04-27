-- Helper: resolve current user's row from the JWT's 'sub' claim (= tg_user_id as string).
create or replace function public.current_app_user()
returns public.users
language sql
stable
security definer
set search_path = public
as $$
  select u.* from public.users u
  where u.tg_user_id = (nullif(auth.jwt() ->> 'sub', ''))::bigint
$$;

revoke all on function public.current_app_user() from public;
grant execute on function public.current_app_user() to anon, authenticated;

-- Enable RLS everywhere.
alter table public.users             enable row level security;
alter table public.student_teachers  enable row level security;
alter table public.messages          enable row level security;
alter table public.notifications     enable row level security;
alter table public.prompts           enable row level security;
alter table public.quota_usage       enable row level security;

-- USERS: self read + admin reads everyone.
create policy users_self_read on public.users
  for select to authenticated
  using (id = (select id from public.current_app_user()));

create policy users_admin_read_all on public.users
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- STUDENT_TEACHERS: teacher reads links they appear in; admin reads all.
create policy st_teacher_read on public.student_teachers
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy st_admin_read on public.student_teachers
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- MESSAGES: teacher reads messages from their linked students (any direction); admin reads all.
create policy messages_teacher_read on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.student_teachers st
      where st.student_id = public.messages.student_id
        and st.teacher_id = (select id from public.current_app_user())
    )
  );

create policy messages_admin_read on public.messages
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- NOTIFICATIONS / PROMPTS: teacher reads their own; admin reads all.
create policy notifications_teacher_read on public.notifications
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy notifications_admin_read on public.notifications
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

create policy prompts_teacher_read on public.prompts
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy prompts_admin_read on public.prompts
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- QUOTA_USAGE: teacher reads quota of their linked students; admin reads all.
create policy quota_teacher_read on public.quota_usage
  for select to authenticated
  using (
    exists (
      select 1 from public.student_teachers st
      where st.student_id = public.quota_usage.student_id
        and st.teacher_id = (select id from public.current_app_user())
    )
  );

create policy quota_admin_read on public.quota_usage
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- No INSERT/UPDATE/DELETE policies for browser/anon: all writes go through service_role on the server.
