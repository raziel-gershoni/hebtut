-- Engagement monitoring flags: one row per (student, concern), updated
-- in place. Open = resolved_at IS NULL. History lives in audit_events
-- (engagement.flag_open / .flag_escalate / .flag_resolve).
create table public.student_flags (
  student_id        bigint not null references public.users(id) on delete cascade,
  kind              text not null check (kind in
                      ('inactive','slump','plateau','ghosting','tutor_sla')),
  tier              text check (tier in ('sliding','at_risk','dormant')),
  opened_at         timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  resolved_at       timestamptz,
  meta              jsonb not null default '{}',
  primary key (student_id, kind)
);
create index student_flags_open_idx on public.student_flags (kind)
  where resolved_at is null;
