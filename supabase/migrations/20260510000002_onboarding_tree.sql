-- Onboarding decision tree state per student. Steps 1–14 of the spec at
-- docs/superpowers/plans/2026-05-10-onboarding-tree.md. Stores the linear
-- path state machine on subscriptions; time-based fires (2h nudge, 24h nudge,
-- meta-explainer +5min, day-2 conversion +5min, survey +1d, churn-followup
-- +5d) live in onboarding_timers and are drained by /api/cron/onboarding.
--
-- Trial drops from 3 to 2 days per the spec. Existing trial rows keep their
-- original trial_ends_at so users mid-trial aren't cut short — only the
-- column default changes, affecting NEW signups.

alter table public.subscriptions
  alter column trial_ends_at set default (now() + interval '2 days');

create type public.onboarding_state as enum (
  'welcome',
  'video1',
  'video2',
  'cta_record',
  'awaiting_first_reply',
  'meta_explainer_pending',
  'day1_active',
  'day2_active',
  'day2_conversion_pending',
  'awaiting_survey',
  'survey_yes',
  'survey_later',
  'survey_no',
  'churn_followup_pending',
  'done_paid',
  'done_churned',
  -- For students who pre-date this feature; never sees onboarding.
  'done_skipped'
);

alter table public.subscriptions
  add column onboarding_state public.onboarding_state not null default 'welcome',
  add column onboarding_state_entered_at timestamptz not null default now(),
  -- Anchor times referenced from cron sweeps + state checks.
  add column onboarding_first_msg_at timestamptz,
  add column onboarding_first_reply_at timestamptz,
  add column onboarding_last_active_at timestamptz,
  -- Day-1 limit message dedupe (it fires at most once per trial).
  add column onboarding_day1_limit_msg_sent_at timestamptz,
  -- Day-2+ pause-nudge dedupe (at most once per calendar day in user tz).
  add column onboarding_last_pause_nudge_at timestamptz;

create index subscriptions_onboarding_state_idx
  on public.subscriptions (onboarding_state)
  where onboarding_state not in ('done_paid', 'done_churned', 'done_skipped');

create type public.onboarding_timer_kind as enum (
  'nudge_2h',           -- step 5: 2h after cta_record
  'nudge_24h',          -- step 6: 24h after cta_record (deferred for quiet hours)
  'meta_explainer',     -- step 8: 5min after first teacher reply
  'day2_conversion',    -- step 11: 5min after day-2 limit hit
  'survey',             -- step 12: 1d after trial ends without payment
  'churn_followup'      -- step 12.3: 5d after survey "Later"
);

create table public.onboarding_timers (
  student_id   bigint not null references public.users(id) on delete cascade,
  kind         public.onboarding_timer_kind not null,
  due_at       timestamptz not null,
  fired_at     timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (student_id, kind)
);

-- Partial index narrows the cron's "what's due now" range scan to just the
-- live rows, leaving fired/cancelled history out of the hot path.
create index onboarding_timers_due_idx
  on public.onboarding_timers (due_at)
  where fired_at is null and cancelled_at is null;

-- Backfill: every existing student is `done_skipped` so they don't suddenly
-- get the welcome flow on their next /start. Fresh signups after the
-- migration get the default 'welcome' and run the full tree.
update public.subscriptions
  set onboarding_state = 'done_skipped',
      onboarding_state_entered_at = now()
  where onboarding_state = 'welcome';

alter table public.onboarding_timers enable row level security;
