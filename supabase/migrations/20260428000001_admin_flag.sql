-- Split 'admin' out of users.role into a separate is_admin permission flag,
-- so the same user can be (e.g.) role='teacher' AND is_admin=true.

-- 1) Drop the 6 admin-read RLS policies. They reference role='admin' via
-- current_app_user(); we'll rebuild them on top of the new is_admin column.
drop policy if exists users_admin_read_all   on public.users;
drop policy if exists st_admin_read          on public.student_teachers;
drop policy if exists messages_admin_read    on public.messages;
drop policy if exists notifications_admin_read on public.notifications;
drop policy if exists prompts_admin_read     on public.prompts;
drop policy if exists quota_admin_read       on public.quota_usage;

-- 2) Add the flag.
alter table public.users
  add column if not exists is_admin boolean not null default false;

-- 3) Migrate existing admins: keep their admin permission, hand them a
-- 'pending' worker role so they can self-pick (teacher / student / pending)
-- via the panel. Run this BEFORE we tighten the role check.
update public.users set is_admin = true where role = 'admin';

-- 4) Drop the original role check (which still allows 'admin'). Constraint
-- was unnamed at creation; locate it dynamically.
do $$
declare con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%admin%';
  if con_name is not null then
    execute format('alter table public.users drop constraint %I', con_name);
  end if;
end $$;

-- 5) Move admin rows to 'pending' (must precede the new check).
update public.users set role = 'pending' where role = 'admin';

-- 6) Add the tightened role check (no 'admin').
alter table public.users
  add constraint users_role_check
  check (role in ('pending','student','teacher'));

-- 7) Rebuild the 6 admin-read policies, this time gated on is_admin.
create policy users_admin_read_all on public.users
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

create policy st_admin_read on public.student_teachers
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

create policy messages_admin_read on public.messages
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

create policy notifications_admin_read on public.notifications
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

create policy prompts_admin_read on public.prompts
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

create policy quota_admin_read on public.quota_usage
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);
