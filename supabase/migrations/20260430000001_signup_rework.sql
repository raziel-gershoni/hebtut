-- Signup rework: auto-student onboarding, teacher invite links, suspend/ban
-- admin actions, and a hard-delete RPC.
--
-- Status enum tightens to active|suspended (the previous 'paused' value is
-- unused). 'banned' is NOT a status — banned users have their `users` row
-- hard-deleted and their tg_user_id moved into `banned_tg_users`.

-- 1) Tighten users.status. The constraint was unnamed at creation, so locate
-- it dynamically (mirrors the pattern used in 20260428000001).
do $$
declare con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%active%paused%';
  if con_name is not null then
    execute format('alter table public.users drop constraint %I', con_name);
  end if;
end $$;

alter table public.users
  add constraint users_status_check
  check (status in ('active','suspended'));

-- 2) Backfill any legacy 'pending' users to 'student' so the new auto-student
-- flow takes effect retroactively. The role enum keeps 'pending' as a valid
-- value for historical audit, but new users skip it.
update public.users set role = 'student' where role = 'pending';

-- 3) Teacher invite tokens. One-time use, revocable.
create table public.teacher_invites (
  id           bigserial primary key,
  token        text unique not null,
  created_by   bigint not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz,
  consumed_by  bigint references public.users(id) on delete set null,
  revoked_at   timestamptz
);

create index teacher_invites_active_idx
  on public.teacher_invites (token)
  where consumed_at is null and revoked_at is null;

-- 4) Permanent blacklist for the Ban action. Snapshots name at ban time so
-- the admin UI can show a meaningful row even after the user row is gone.
create table public.banned_tg_users (
  tg_user_id    bigint primary key,
  name_snapshot text,
  banned_at     timestamptz not null default now(),
  banned_by     bigint references public.users(id) on delete set null
);

-- 5) Hard-delete RPC. Some FKs cascade (student_teachers, claims, quota_usage,
-- inbox_reads) but messages/prompts/notifications don't, so we remove them
-- explicitly inside one transaction.
create or replace function public.delete_user_cascade(target_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.notifications where teacher_id = target_id;
  delete from public.prompts where teacher_id = target_id;
  delete from public.messages
    where student_id = target_id
       or teacher_id = target_id
       or claimed_by_teacher_id = target_id;
  delete from public.users where id = target_id;
end;
$$;
