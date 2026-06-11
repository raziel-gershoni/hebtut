# Engagement monitoring — design

**Date:** 2026-06-11
**Status:** approved (brainstormed interactively; research-backed)

## Problem

Nobody notices when a student quietly stops practicing, winds down, or
stalls — the admin finds out weeks later, when the save window is long
gone. We need automated heuristics that flag inactivity, decline, and
plateau, and put them in front of the admin daily.

## Research grounding (summary)

Fanned-out research over Duolingo's published retention machinery, MOOC
dropout-prediction literature, K-12 early-warning systems (ABC
indicators), and ops alerting practice converged on:

- **Rule-based beats ML below thousands of users** (Rudin; EWS practice;
  Duolingo's own CURR buckets are deterministic recency rules). Hand-set,
  transparent thresholds; no learned models.
- **No score summing** — ABC-style "one flag is enough"; each concern is
  its own flag with its own lifecycle.
- **Recency buckets are the backbone**: 2–6 / 7–29 / 30+ days are
  Duolingo's exact boundaries; days 3–4 are the empirical save window.
- **Week-over-week volume decline predicts churn before absence does** —
  the strongest early feature in the dropout literature.
- **Flag lifecycle needs hysteresis + dedup** (one open flag per
  student+concern, updated in place; only transitions notify) — the
  standard fix for alert flapping/fatigue.
- **Alert volume must fit human capacity** — thresholds sized so the
  queue stays single-digit; a daily digest, not per-event pushes.

## Decisions (from brainstorm)

- **Consumer: admin only.** Daily digest DM + journal events + a
  read-only «Активность» panel. No student-facing or tutor-facing
  messaging in v1.
- **Population: trial + active only** (derived kinds trial,
  trial_ending, active, renewing_soon; role student; not
  suspended/banned). Queued / frozen / trial_expired / lapsed /
  payment_failed are invisible — their state already explains silence.
- **Cadence: one daily digest** (~09:00 Israel), only on days with
  something open. Transitions journal immediately at cron time.
- **Architecture: minimal state (approach A)** — a `student_flags`
  table + a daily cron; state exists chiefly so the digest can split
  «новые» vs «всё ещё» and the journal records transitions.
- **Thresholds: named constants** in `src/server/engagement.ts`.
  Promoting them to `app_settings` is explicitly v2.

## The five flags

Day-math in `users.tz` (fallback `DEFAULT_TZ`), via the existing
`localDateInTz` helpers. "Practiced day" = `quota_usage.seconds_used >=
30` (the streak threshold, reused).

| kind | opens when | tiers | resolves when |
|---|---|---|---|
| `inactive` | ≥2 full days since anchor. Anchor = last practiced day, or trial/account start if never practiced | sliding 2–6d · at_risk 7–29d · dormant 30+d (escalates in place) | a new practiced day appears (immediate; no margin needed) |
| `slump` | trailing 7d seconds < 50% of prior 7d AND prior 7d ≥ 600s. Only evaluated while no `inactive` flag is open | — | trailing 7d ≥ 75% of prior 7d (hysteresis) |
| `plateau` | streak ≥ 7 AND median of last 7 practiced days < max(90s, 50% of trailing-30d median) | — | 7d median ≥ 70% of 30d median, or streak breaks |
| `ghosting` | latest outbound newer than latest inbound AND gap ≥ 72h (the `teacherWaitingForReply` comparison, lifted from motivation.ts into a shared helper) | — | any inbound from the student |
| `tutor_sla` | any message `status='pending'` older than 24h (alerts admin ABOUT the tutor) | — | nothing pending older than threshold |

Constants (all in `src/server/engagement.ts`):
`INACTIVE_SLIDING_DAYS=2`, `INACTIVE_AT_RISK_DAYS=7`,
`INACTIVE_DORMANT_DAYS=30`, `SLUMP_RATIO=0.5`,
`SLUMP_RESOLVE_RATIO=0.75`, `SLUMP_MIN_PRIOR_SECONDS=600`,
`PLATEAU_MIN_STREAK=7`, `PLATEAU_SHALLOW_SECONDS=90`,
`PLATEAU_RELATIVE=0.5`, `PLATEAU_RESOLVE_RATIO=0.7`,
`GHOSTING_HOURS=72`, `TUTOR_SLA_HOURS=24`.

## Data model

```sql
create table public.student_flags (
  student_id        bigint not null references public.users(id) on delete cascade,
  kind              text not null check (kind in
                      ('inactive','slump','plateau','ghosting','tutor_sla')),
  tier              text,            -- only `inactive`: sliding|at_risk|dormant
  opened_at         timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  resolved_at       timestamptz,     -- null = open
  meta              jsonb not null default '{}',
  primary key (student_id, kind)
);
create index student_flags_open_idx on public.student_flags (kind)
  where resolved_at is null;
```

One row per (student, concern), updated in place. Open =
`resolved_at is null`. Re-open overwrites the row (fresh `opened_at`);
history lives in the journal. `meta` carries the human-readable numbers
(`days_silent`, `current_week_s`, `prior_week_s`, `streak`,
`median7_s`, `median30_s`, `gap_hours`, `pending_message_id`,
`pending_hours`, `reason`).

## Cron `/api/cron/engagement`

New QStash schedule in `scripts/sync-qstash.mjs`: `0 6 * * *` UTC
(≈09:00 Israel). Auth `Bearer CRON_SECRET`, GET+POST, fail-soft per
student, returns transition counts. One run:

1. Load monitored population (users⋈subscriptions, derived-status
   filter) + all open flags.
2. Evaluate signals per student: batched `quota_usage` reads (the
   `getSignedRemainingForManyToday` pattern), latest in/out message
   timestamps, oldest pending message.
3. `diffFlagStates(existing, desired)` (pure) → transitions:
   `open` / `escalate` (tier change) / `resolve` /
   `resolve(excluded)` for students who left the population.
4. Apply each transition (upsert) + `recordAudit`:
   `engagement.flag_open` / `engagement.flag_escalate` /
   `engagement.flag_resolve`, meta = metric snapshot.
5. Digest: if any flags are open, DM every admin (fan-out pattern from
   `fanOutNewUserToAdmins`, fail-soft, audited as
   `engagement.digest_sent`): new flags itemized first, then ongoing
   summary, `web_app` button → admin panel. Nothing open → no DM.

A student practicing again mid-tier resolves outright (no walking back
through tiers). Daily cadence makes DM-level flapping structurally
impossible.

## Admin surfaces

**Panel «Активность»** — new `CollapsibleSection` on `/admin`, placed
first (daily-triage surface). Read-only. Severity groups:

- 🔴 needs attention: `inactive:at_risk|dormant`, `tutor_sla`, `ghosting`
- 🟡 sliding: `inactive:sliding`, `slump`
- ⚪ plateau: `plateau`

Row = avatar + preferred name + one metric line rendered from meta
(«молчит 12 дней», «минус 60% за неделю», «серия 14 дней, по ~40с»,
«тренер ждёт 4 дня», «ответ висит 26 ч») + «с {date}». Tap → the
existing TG profile-link affordance. Empty state: «Все занимаются 🎉».

**API** `GET /api/admin/engagement` (admin-only): open flags joined
with user display fields, pre-grouped by severity. No mutations in v1.

**Journal**: register in `ACTION_DEFS` + `ru.admin.audit.actions` (the
`message.scheduled` lesson — unregistered actions render raw and are
unfilterable): `engagement.flag_open` (amber), `engagement.flag_escalate`
(rose), `engagement.flag_resolve` (emerald), `engagement.digest_sent`
(grey). `metaSummary` one-liners, e.g. `inactive→at_risk · 8д`.

**Digest DM copy** (strings in `ru.bot.notifications.*`):

```
📊 Активность: 2 новых, 4 всего

🆕 Игорь — молчит 3-й день
🆕 Оля — минус 60% за неделю

Всё ещё: Лиза (12 дней), Макс (тренер ждёт), Вера (плато)

[ Открыть панель ]
```

## Edge cases

- **Cold start**: first run flags the whole backlog; first digest is
  big — accepted, it's the true current state.
- **Never-practiced trial users**: anchor = trial start → they flag
  `inactive` from day 2, deliberately (most urgent case). Trials
  younger than 2 days can't flag — free from the anchor math.
- **Left population mid-flag**: resolve with `meta.reason='excluded'`.
- **No tutor linked**: `ghosting`/`tutor_sla` can't fire; volume flags
  still apply.
- **`ghosting` + `inactive` together**: allowed (different stories);
  digest names the student once with the worst flag.
- **Deleted user**: FK cascade cleans flags.
- **TZ**: per-student day-math despite the global sweep hour; ±1-day
  boundary error for far-east timezones accepted.

## Testing

Pure helpers, unit-tested without Supabase (project pattern):
`classifyInactivity`, `evaluateSlump`, `evaluatePlateau`,
`diffFlagStates` — boundary matrices for each (tier boundaries at
1/2/6/7/29/30; slump ratio/floor/hysteresis; plateau absolute vs
relative bars; diff open/escalate/resolve/excluded incl. resolve-not-
downgrade). Cron follows the deliver-scheduled shape; integration is
the manual matrix: seed states → run cron → verify flags, journal
entries, digest DM, panel rendering, and resolve-on-practice.

## Out of scope (v2+)

- Student-facing nudges (streak-saver, win-back ladders,
  habitual-hour timing) and tutor-facing alerts.
- Manual snooze/resolve actions in the panel.
- Threshold editing in admin Settings.
- Onboarding-stall and trial-end-triage flags (overlap existing
  onboarding/billing machinery).
- Real progress metrics from transcripts (the `progress_metric` TODO).
- Any ML / learned thresholds.
