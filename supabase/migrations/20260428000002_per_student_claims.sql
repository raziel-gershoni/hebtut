-- Per-(student,teacher) sliding TTL claim, replacing the per-message
-- `messages.status='claimed'` model. The new table holds at most one row
-- per student (PK), and `expires_at` is refreshed on every teacher action.

create table public.claims (
  student_id   bigint primary key references public.users(id) on delete cascade,
  teacher_id   bigint not null references public.users(id) on delete cascade,
  claimed_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index claims_teacher_idx on public.claims (teacher_id);
create index claims_expires_idx on public.claims (expires_at);

-- teacher_id must reference a user with role='teacher'
create or replace function public.enforce_claim_teacher_role()
returns trigger
language plpgsql
as $$
declare t_role text;
begin
  select role into t_role from public.users where id = new.teacher_id;
  if t_role <> 'teacher' then
    raise exception 'user % is not a teacher (role=%)', new.teacher_id, t_role;
  end if;
  return new;
end;
$$;

create trigger claims_teacher_role_check
before insert or update on public.claims
for each row execute function public.enforce_claim_teacher_role();

-- RLS — teacher reads claims for students they're linked to; admin reads all.
alter table public.claims enable row level security;

create policy claims_teacher_read on public.claims
  for select to authenticated
  using (
    exists (
      select 1 from public.student_teachers st
      where st.student_id = public.claims.student_id
        and st.teacher_id = (select id from public.current_app_user())
    )
  );

create policy claims_admin_read on public.claims
  for select to authenticated
  using ((select is_admin from public.current_app_user()) = true);

-- Realtime publication for the Mini App.
alter publication supabase_realtime add table public.claims;

-- Migrate any in-flight per-message claims into per-student claims.
-- Best-effort: take the most recent row per student. TTL = 15 min from
-- claimed_at (matches CLAIM_TTL_MINUTES default).
with latest as (
  select distinct on (student_id)
    student_id, claimed_by_teacher_id, claimed_at
  from public.messages
  where status = 'claimed' and claimed_by_teacher_id is not null
  order by student_id, claimed_at desc
)
insert into public.claims (student_id, teacher_id, claimed_at, expires_at)
select student_id, claimed_by_teacher_id, claimed_at,
       claimed_at + interval '15 minutes'
from latest
on conflict (student_id) do nothing;

-- Revert all 'claimed' messages to 'pending'. The per-student claim now
-- carries that state.
update public.messages set status = 'pending' where status = 'claimed';

-- Tighten messages.status to drop 'claimed' from the enum.
do $$
declare con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.messages'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%claimed%';
  if con_name is not null then
    execute format('alter table public.messages drop constraint %I', con_name);
  end if;
end $$;

alter table public.messages
  add constraint messages_status_check
  check (status in ('pending','answered','expired','orphaned'));

-- The previous partial index referenced 'claimed' in its predicate.
drop index if exists messages_status_idx;
create index messages_status_idx on public.messages (status) where status = 'pending';
