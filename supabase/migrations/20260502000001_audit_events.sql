-- Audit log of every meaningful state-changing action: claim lifecycle,
-- message ins/outs, signups, admin mutations. Diagnostic + oversight.
--
-- Read-only from the admin UI; written from server-side handlers via
-- src/server/audit.ts. Action codes are free-text by convention so the
-- table doesn't need a migration each time we add a new event kind.

create table public.audit_events (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  -- NULL for system events (cron expiry, fan-out, etc).
  actor_id     bigint references public.users(id) on delete set null,
  -- Convention: <area>.<verb>, e.g. claim.refresh, message.in,
  -- admin.role_change, admin.user_ban, signup.student, invite.consume.
  action       text not null,
  -- Convention: 'user' | 'message' | 'claim' | 'invite' | 'link' | 'banlist'.
  subject_type text,
  subject_id   bigint,
  -- Free-form payload. Stays small (<1KB per row).
  meta         jsonb not null default '{}'::jsonb
);

create index audit_events_created_idx
  on public.audit_events (created_at desc);
create index audit_events_actor_idx
  on public.audit_events (actor_id, created_at desc)
  where actor_id is not null;
create index audit_events_action_idx
  on public.audit_events (action, created_at desc);
create index audit_events_subject_idx
  on public.audit_events (subject_type, subject_id, created_at desc)
  where subject_type is not null;

-- Realtime publication so the admin journal page can prepend new rows
-- without polling.
alter publication supabase_realtime add table public.audit_events;
