-- Append-only event log for tutor work-time tracking.
-- Each row represents an interval of work attributed to one of three kinds.
-- The merge step (server-side, at read time) collapses overlapping intervals
-- by priority recording > playback > active to produce billable totals.

create table public.tutor_work_events (
  id           bigserial primary key,
  tutor_id     bigint not null references public.users(id) on delete cascade,
  kind         text not null check (kind in ('active', 'playback', 'recording')),
  started_at   timestamptz not null,
  ended_at     timestamptz not null check (ended_at >= started_at),
  ref_id       bigint,
  source       text not null,
  duration_s   int generated always as (
                 extract(epoch from (ended_at - started_at))::int
               ) stored,
  created_at   timestamptz not null default now()
);

create index tutor_work_events_tutor_day_idx
  on public.tutor_work_events (tutor_id, started_at);
create index tutor_work_events_kind_idx
  on public.tutor_work_events (kind);
