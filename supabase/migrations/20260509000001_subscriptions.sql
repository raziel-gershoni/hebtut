-- Subscriptions: per-student lifecycle state for the trial/active/frozen/expired
-- model documented in docs/superpowers/plans/2026-05-06-subscriber-mini-app.md.
--
-- Columns are deliberately denormalized vs. a separate billing-events table:
-- the Mini App home card and the access-gate read this row on every request,
-- so we keep the hot fields (trial_ends_at, current_period_ends_at, status,
-- last_lockout_replied_at) on a single row keyed by user_id. Provider IDs
-- are opaque strings populated by the BillingProvider adapter.

create type public.subscription_status as enum (
  'trial',          -- in active trial, before trial_ends_at
  'active',         -- paid, before current_period_ends_at
  'trial_expired',  -- trial ran out, never paid
  'lapsed',         -- previously paid, current_period_ends_at passed without renewal
  'payment_failed', -- attempted payment failed (provider returned an error)
  'frozen'          -- subscription paused via the freeze feature
);

create table public.subscriptions (
  user_id                       bigint primary key references public.users(id) on delete cascade,
  status                        public.subscription_status not null default 'trial',
  trial_started_at              timestamptz not null default now(),
  trial_ends_at                 timestamptz not null default (now() + interval '3 days'),
  current_period_starts_at      timestamptz,
  current_period_ends_at        timestamptz,
  -- Snapshot so we can show "продление через 2 дня" even if the cron hasn't
  -- ticked yet. Mirrors current_period_ends_at when active.
  next_renewal_at               timestamptz,
  -- Freeze feature: rolling 3-day budget per calendar month.
  freeze_days_used_in_period    int not null default 0,
  freeze_period_started_at      timestamptz, -- when the 3-day budget last reset
  frozen_until                  timestamptz, -- only set while status='frozen'
  -- Response window: hold teacher-INITIATED messages outside this range.
  -- Replies during an active claim deliver immediately regardless.
  response_window_start         time,
  response_window_end           time,
  response_window_tz            text not null default 'Asia/Jerusalem',
  -- Billing provider linkage. Opaque to this app — the BillingProvider
  -- adapter owns these values.
  provider                      text, -- 'tg_stars' | 'tg_payments' | 'stripe'
  provider_subscription_id      text,
  provider_customer_id          text,
  -- Referral linkage: populated at /start ?ref=<token> for new students.
  referred_by_user_id           bigint references public.users(id) on delete set null,
  -- Motivation copy de-duplication: avoid showing the same string two days in a row.
  last_motivation_key           text,
  last_motivation_shown_on      date,
  -- Access-gate rate limit: when a locked user sends media we reply once,
  -- then go silent for 24h to avoid chat spam on every retry.
  last_lockout_replied_at       timestamptz,
  -- Renewal reminder de-duplication: don't DM the same user twice per period.
  last_renewal_reminder_sent_at timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_trial_ends_idx on public.subscriptions (trial_ends_at)
  where status = 'trial';
create index subscriptions_period_ends_idx on public.subscriptions (current_period_ends_at)
  where status in ('active', 'frozen');
create index subscriptions_referred_by_idx on public.subscriptions (referred_by_user_id)
  where referred_by_user_id is not null;

-- Backfill: every existing student gets a FRESH 3-day trial from rollout.
-- Anchoring to migration-time (rather than users.created_at) avoids silently
-- locking out long-time users on day one of this feature.
insert into public.subscriptions (user_id, status, trial_started_at, trial_ends_at)
select u.id, 'trial'::public.subscription_status, now(), now() + interval '3 days'
from public.users u
where u.role = 'student'
on conflict (user_id) do nothing;

alter table public.subscriptions enable row level security;
