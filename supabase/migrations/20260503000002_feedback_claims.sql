-- Per-user feedback claim, mirroring `claims` for the lesson flow but for
-- the admin pool answering feedback. PK on user_id ⇒ at most one admin
-- claims a given user's feedback chat at a time. The same expire-claims
-- cron deletes expired rows.

create table public.feedback_claims (
  user_id    bigint primary key references public.users(id) on delete cascade,
  admin_id   bigint not null references public.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index feedback_claims_admin_idx on public.feedback_claims (admin_id);
create index feedback_claims_expires_idx on public.feedback_claims (expires_at);

-- Realtime so /admin/feedback list + thread can react to claim changes
-- without polling.
alter publication supabase_realtime add table public.feedback_claims;
