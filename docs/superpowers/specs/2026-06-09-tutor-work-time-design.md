# Tutor work-time tracking — design

**Date:** 2026-06-09
**Status:** Approved, ready for implementation plan

## Problem

Tutors are billed by time worked. The platform currently has no measurement — payouts are guesses. We need a billing-grade, robust, auditable signal of how much time each tutor actually spends doing tutoring work.

## Goal

Build the data-collection pipeline + an admin viewer that surfaces per-tutor totals (today / this week / this month / custom range) with a per-bucket breakdown (active / playback / recording) so the admin can read totals and pay tutors out-of-band.

## Non-goals (v1)

- CSV export or any automated billing artifact (v2).
- Tutor-facing self-visibility — tutors don't see their own totals in v1.
- Bot DM digests to tutors.
- Per-student time attribution (active heartbeats stay unscoped — `ref_id` is null for active).
- Historical reconstruction — events accumulate from ship date.
- Admin-panel-time billing — only inbox + ThreadView fire heartbeats.

## Background

Existing signals available in the codebase:
- `WebApp.isActive` + `activated`/`deactivated` events (TG Bot API 8.0+) — reliable "this Mini App is the foreground Mini App" signal.
- `PlaybackProvider` exposes `startPlay(id)`/`endPlay(id)` per messageId — clean subscription point for student-media playback intervals.
- Webhook handler at `src/server/handlers/teacher-reply.ts:155` captures outbound voice/video_note duration from TG payload (server-side authoritative — tutor can't tamper).
- `audit_events` exists for general audit, but work-time data is high-volume and merits its own table.

## Design

### Locked-in rules

1. **Three signals, mutually exclusive priority order:** `recording > playback > active`. Each second is credited to exactly one kind.
2. **Per-play cap:** an individual playback interval's duration ≤ message's file duration. No cumulative cap — re-listening a 30s voice 4 times is 4×30s of legitimate work.
3. **Cross-validation:** a playback event must overlap an active heartbeat window. Otherwise reject.
4. **Server time authority:** heartbeats and playback events use the server's `now()` for `started_at`/`ended_at`, not client-claimed timestamps.
5. **Idle pause:** if no scroll/click/keydown/touchstart for 2 minutes, client stops heartbeats. Resumes on next input.
6. **Daily cap:** 16-hour sanity ceiling per tutor per day, applied at read time. Raw events untouched.
7. **Active scope:** only `InboxList` and `ThreadView` fire heartbeats. Admin panel and feedback surfaces don't.

### Data model

**New table `tutor_work_events`:**

```sql
create table public.tutor_work_events (
  id           bigserial primary key,
  tutor_id     bigint not null references public.users(id) on delete cascade,
  kind         text not null check (kind in ('active', 'playback', 'recording')),
  started_at   timestamptz not null,
  ended_at     timestamptz not null check (ended_at >= started_at),
  ref_id       bigint,                              -- student_id for playback/recording; null for active
  source       text not null,                       -- 'heartbeat' | 'playback_provider' | 'tg_webhook'
  duration_s   int generated always as (
                 extract(epoch from (ended_at - started_at))::int
               ) stored,
  created_at   timestamptz not null default now()
);
create index tutor_work_events_tutor_day_idx
  on public.tutor_work_events (tutor_id, started_at);
create index tutor_work_events_kind_idx
  on public.tutor_work_events (kind);
```

All three kinds share one table — same interval+ref shape. Splitting per kind triples join work for the merge query without buying anything.

### Heartbeat protocol

**Endpoint `POST /api/tutor-work/heartbeat`:**
- Auth: tutor JWT (admin acting-as-tutor: skip — admin-panel routes don't mount the hook).
- Server inserts one row: `kind='active', tutor_id=jwt.sub, started_at=now()-HEARTBEAT_CADENCE_SEC, ended_at=now(), ref_id=null, source='heartbeat'`.
- Stateless — interval-per-heartbeat. Merge step at read time collapses contiguous intervals.

**Client hook `useWorkHeartbeat(enabled, jwt)`:**
Lives in `src/hooks/useWorkHeartbeat.ts`. Mounted by `InboxList` and `ThreadView`.

Conditions to fire a heartbeat (all must hold):
1. Hook is `enabled`.
2. `WebApp.isActive === true` (via TG SDK).
3. `document.visibilityState === 'visible'` (defensive).
4. Last user input (`scroll`/`click`/`keydown`/`touchstart`) < 2 min ago.

Cadence: 30s interval + immediate fire on mount + final flush via `navigator.sendBeacon` on `beforeunload` and on TG `deactivated` event.

**Playback events** — `POST /api/tutor-work/playback`:
- Body: `{ messageId: number, started_at: ISO, ended_at: ISO }` (client-claimed timestamps — verified server-side).
- PlaybackProvider posts on `endPlay(messageId)` (and on component unmount if a play is mid-flight).
- Server validation:
  1. Look up `messages.id = messageId`. Verify: `direction='in'`, kind ∈ `voice`/`video_note`, student is linked to this tutor.
  2. Clamp `ended_at - started_at ≤ message.duration`. Trim from the end if needed.
  3. Verify at least one `kind='active'` row overlaps `[started_at, ended_at]` for this tutor. If not → reject (log + drop, no error to user).
  4. Insert `kind='playback', ref_id=message.student_id, source='playback_provider'` with the clamped interval.

**Recording events** — wired into `src/server/handlers/teacher-reply.ts`:
- After successful outbound relay, insert `kind='recording', tutor_id=teacher_id, ref_id=student_id, started_at=now()-duration, ended_at=now(), source='tg_webhook'`.
- Uses TG webhook-reported `voice.duration` / `video_note.duration`. No further validation.

### Merge algorithm

**Pure helper in `src/server/tutor-work.ts`:**

```ts
type Interval = { start: number; end: number }; // ms timestamps

export function mergeIntervals(raw: Interval[]): Interval[];
// Sort by start, sweep: if next.start ≤ current.end, extend; else, emit current and advance.

export function subtractIntervals(base: Interval[], toRemove: Interval[]): Interval[];
// Sort both, sweep: for each base interval, carve out any overlapping toRemove intervals.

export function intervalsDurationS(ivs: Interval[]): number;
// Sum (end - start) / 1000.

export function computeWorkBuckets(events: {
  kind: "recording" | "playback" | "active";
  started_at: Date;
  ended_at: Date;
}[]): { recording_s: number; playback_s: number; active_s: number; total_s: number } {
  const byKind = groupByKind(events);
  const recording = mergeIntervals(byKind.recording);
  const playback = subtractIntervals(mergeIntervals(byKind.playback), recording);
  const active = subtractIntervals(
    subtractIntervals(mergeIntervals(byKind.active), recording),
    playback,
  );
  return {
    recording_s: intervalsDurationS(recording),
    playback_s: intervalsDurationS(playback),
    active_s: intervalsDurationS(active),
    total_s: intervalsDurationS(recording) + intervalsDurationS(playback) + intervalsDurationS(active),
  };
}
```

Daily cap applied separately after `computeWorkBuckets`: if `total_s > 16*3600`, clamp `total_s` and the per-bucket numbers proportionally (preserving the breakdown ratio).

### Admin API

**`GET /api/admin/tutor-work?from=YYYY-MM-DD&to=YYYY-MM-DD&tutorId?=...`:**

Auth: admin only.

```ts
{
  range: { from: "2026-06-01", to: "2026-06-09", days: 9 },
  tutors: [
    {
      tutor_id: 42,
      tutor_name: "Иван",          // preferred_name ?? name
      tutor_has_avatar: true,
      days: [
        { date: "2026-06-09", recording_s: 540, playback_s: 1200, active_s: 7800, total_s: 9540 },
        // ... one entry per day in range, zeros for inactive days
      ],
      totals: { recording_s: 4860, playback_s: 10800, active_s: 70200, total_s: 85860 },
    },
    // ... one per tutor
  ],
}
```

**Implementation:**
1. SELECT rows from `tutor_work_events` where `started_at ∈ [from_day_start_admin_tz, to_day_end_admin_tz)` and optionally `tutor_id = $1`.
2. Group by `(tutor_id, started_at::date in admin tz)`.
3. For each group, run `computeWorkBuckets`. Apply daily cap.
4. Sum into `totals`. Resolve tutor display name + avatar via `users` join.

Day boundaries use admin tz for grouping. Multi-tz tutors get assigned to admin-tz days — acceptable simplification for v1.

### Admin Mini App surface

**New component `src/components/AdminTutorWorkPanel.tsx`**, mounted in `src/app/admin/page.tsx` inside a new `<CollapsibleSection id="tutor-work" title="Рабочее время тренеров">` block (default-closed, after existing sections).

Layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Рабочее время тренеров                              [▾]            │
├─────────────────────────────────────────────────────────────────────┤
│ Период: [Сегодня][Эта неделя][Этот месяц] [с 2026-06-01 по 06-09] │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [Avatar] Иван                              Всего: 23ч 51м       │ │
│ │           ⏱ актив 19ч 30м · ▶ прослушка 3ч · 🎙 запись 1ч 21м │ │
│ │           Сегодня: 2ч 39м                                       │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ [Avatar] Мария                             Всего: 18ч 12м       │ │
│ │           ⏱ актив 14ч 5м · ▶ прослушка 2ч 30м · 🎙 запись 1ч 37м│ │
│ │           Сегодня: 0м                                           │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

Three preset range buttons (Сегодня / Эта неделя / Этот месяц) + a custom date range. Per-tutor card: period total + bucket breakdown + today's total. Sort tutors by period total descending.

### i18n

New group in `src/lib/i18n/admin.ts`:

```ts
const tutorWork = {
  sectionTitle: "Рабочее время тренеров",
  rangeTodayBtn: "Сегодня",
  rangeWeekBtn: "Эта неделя",
  rangeMonthBtn: "Этот месяц",
  customRangeFrom: "с",
  customRangeTo: "по",
  bucketActiveLabel: "актив",
  bucketPlaybackLabel: "прослушка",
  bucketRecordingLabel: "запись",
  periodTotalLabel: "Всего:",
  todayTotalLabel: "Сегодня:",
  noActivity: "Нет активности",
  // formatDuration helpers exist already in src/lib/i18n
};
```

Exported under `ru.admin.tutorWork.*`.

## Testing

### Unit tests

`tests/tutor-work-merge.test.ts` (new file):

```
describe("mergeIntervals")
  empty → empty
  single → single
  two disjoint → both
  two touching at boundary → merged
  two overlapping → merged
  three with chain merge → single
  unsorted input → still correct
  zero-length interval → dropped

describe("subtractIntervals")
  empty base → empty
  empty toRemove → base unchanged
  toRemove fully covers base → empty
  partial overlap at start → trimmed left
  partial overlap at end → trimmed right
  toRemove inside base → base split into two
  multiple holes → multiple pieces
  disjoint toRemove → base unchanged

describe("computeWorkBuckets")
  all empty → all zeros
  recording only → recording_s = total
  playback only → playback_s = total
  active only → active_s = total
  playback overlaps active → active = playback-free remainder
  recording overlaps playback → playback = recording-free remainder
  all three overlap → recording credited, others trimmed
  ladder pattern (active 10:00-11:00, playback 10:30-10:45, recording 10:40-10:42)
    → recording_s=2, playback_s=13, active_s=45, total_s=60
  daily cap clamp (raw > 16h) → returns 16h
```

`tests/tutor-work-validation.test.ts` (new file — pure validation helpers extracted from the route):

```
describe("validatePlayback")
  no overlapping active heartbeat → reject
  duration > message duration → clamp
  message from non-linked student → reject
  outbound message → reject (only inbound)
  valid → accept
```

No Supabase mocking: extract validation as pure functions taking pre-fetched data, like the Task 1 quota refactor pattern.

### Manual smoke matrix

| Scenario | Expected |
|---|---|
| Tutor opens Mini App, sits on inbox for 90s | one `active` row, ~90s span |
| Tutor sends 30s voice reply | one `recording` row with 30s span |
| Tutor plays a student's 45s voice fully, then again | two `playback` rows, 45s + 45s |
| Tutor curls playback endpoint with no overlapping active | rejected, no row |
| Tutor leaves app open, walks away for 10 min | heartbeats stop after 2 min idle |
| Tutor switches TG to background | `deactivated` fires, flush sent, no more rows |
| Admin opens panel, picks "Сегодня" | per-tutor totals match the day's rows |
| Admin picks date range crossing midnight | days array has correct per-day buckets |
| Admin filters to one tutor | only that tutor in the response |

### Inverse cases

- Widen idle threshold 2→5min → tutors credited more thinking time
- Narrow 2→1min → tighter gating, lower totals
- Daily cap 16h→8h → clamps high-volume tutors lower
- Suspend a tutor → no new rows accumulate; historical preserved

### Performance targets

- 1,000 events/tutor/day → merge runs in <50ms
- 10 tutors × 30 days × 1,000 events = 300k rows → admin viewer responds in <2s
- `tutor_work_events_tutor_day_idx` drives the range query

## Files

### New
- `supabase/migrations/<ts>_tutor_work_events.sql` — table + indexes
- `src/hooks/useWorkHeartbeat.ts` — client hook (idle, isActive, visibility, cadence, flush)
- `src/app/api/tutor-work/heartbeat/route.ts` — `POST` endpoint
- `src/app/api/tutor-work/playback/route.ts` — `POST` endpoint with validation
- `src/server/tutor-work.ts` — pure helpers: `mergeIntervals`, `subtractIntervals`, `intervalsDurationS`, `computeWorkBuckets`, `applyDailyCap`
- `src/server/tutor-work-validation.ts` — pure: `validatePlayback`
- `src/app/api/admin/tutor-work/route.ts` — `GET` endpoint
- `src/components/AdminTutorWorkPanel.tsx`
- `tests/tutor-work-merge.test.ts`
- `tests/tutor-work-validation.test.ts`

### Modified
- `src/components/InboxList.tsx` — mount `useWorkHeartbeat(role === "teacher", jwt)`
- `src/components/ThreadView.tsx` — mount `useWorkHeartbeat(role === "teacher", jwt)`
- `src/components/PlaybackProvider.tsx` — POST `/api/tutor-work/playback` on `endPlay`
- `src/server/handlers/teacher-reply.ts` — insert `recording` event after successful outbound
- `src/app/admin/page.tsx` — add `<CollapsibleSection><AdminTutorWorkPanel /></CollapsibleSection>`
- `src/lib/i18n/admin.ts` — add `tutorWork` group

## Out of scope

- CSV export (v2)
- Tutor self-view (v2)
- Bot DM digests (v2)
- Per-student attribution of active time (v2)
- Multi-tz day boundary correctness (v2; v1 uses admin tz)
- Historical reconstruction
- Admin-panel-time billing
- Real-time SSE updates of the admin panel
