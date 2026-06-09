# Quota indicator for tutors — design

**Date:** 2026-06-09
**Status:** Approved, ready for implementation plan

## Problem

A student silently runs out of their daily voice/video-note quota and stops receiving responses from the bot's pipeline. From the tutor's side, the student simply goes quiet. The tutor has no way to distinguish "they're ghosting me" from "they hit the cap." This produces uncertainty and lost interventions.

## Goal

Surface a clear, glanceable signal to the tutor — in the Mini App chatlist and inside the chat header — that a student is close to or past their daily quota.

## Non-goals

- DM push from the bot to the tutor on threshold trips (UI-only is enough — confirmed during brainstorm).
- Per-tutor settings toggle. Always on.
- Custom thresholds per student.
- Live tick-down inside the chat. Stale-by-API-refresh is fine.
- Suppression flag based on subscription state. Naturally handled (frozen/expired students don't accumulate quota usage).

## Background

The existing quota plumbing:

- `DAILY_QUOTA_SECONDS` — env-configured cap (e.g., 180s).
- `quota_usage(student_id, date, seconds_used)` — per-day debit per student.
- `getRemainingForToday(userId, tz)` — already returns clamped-non-negative remaining for one student.
- `OVERFLOW_GRACE_SECONDS` — single-shot grace for the first message that crosses the cap. Independent of the indicator.
- Quota is enforced for every student regardless of subscription tier; access-gate (frozen/lapsed/trial_expired) blocks before the quota check, so blocked students never accumulate usage.

## Design

### Two states + one no-state

Computed client-side from a single signed integer field on the wire.

| `quota_remaining_seconds` | Pill |
|---|---|
| `> 30` | hidden |
| `1 ≤ r ≤ 30` | amber: `⏱ Почти лимит · {r}с` |
| `r == 0` | red: `⏰ Лимит достигнут` |
| `r < 0` | red: `⏰ Превышен · +{|r|}с` |

Threshold (30s) is a client-side constant. Changing it later is one i18n + one component edit; no server change.

### Data flow

```
DAILY_QUOTA_SECONDS (env)
quota_usage(student_id, date, seconds_used) ──┐
users.tz ──────────────────────────────────────┤
                                               ▼
       per-tz batched SELECT  ─►  cap - usedSeconds (signed)
                                               │
                                               ▼
                  quota_remaining_seconds: int (no clamp)
                                               │
                              ┌────────────────┴────────────────┐
                              ▼                                 ▼
                     /api/inbox row              /api/threads/[studentId]
                              │                                 │
                              ▼                                 ▼
                       <QuotaPill>                       <QuotaPill>
                       (InboxList)                       (ThreadView header)
```

The wire field is *signed*. Negative means over-by `abs(r)`. The existing `computeRemaining` helper clamps to `≥ 0`; we'll introduce a sibling for the unclamped case rather than change the existing one (other callers rely on clamping).

### Server

**New helper** in `src/server/quota.ts`:

```ts
export async function getSignedRemainingForManyToday(
  userIds: number[],
): Promise<Map<number, number>>
```

Implementation outline:

1. SELECT `id, tz` for the given user ids (one query).
2. Group ids by tz (in practice 1 group).
3. For each tz group, compute today's date with `localDateInTz`, then one SELECT on `quota_usage` keyed on `(student_id IN (...), date = today)`.
4. For each input id, return `DAILY_QUOTA_SECONDS - (usage or 0)` (signed, no clamp).
5. Missing tz → fall back to UTC.

**Cost** — for the admin oversight view with N students all in one tz: 2 queries total. For multi-tz: 1 + K queries where K = distinct tz count. Negligible.

**Wiring:**

- `src/app/api/inbox/route.ts` — after building the chats array, call the helper with `studentIds`, decorate each `InboxChat` with `quota_remaining_seconds: number`. Add the field to the `InboxChat` interface (line ~24).
- `src/app/api/threads/[studentId]/route.ts` — call with `[studentId]`, attach `quota_remaining_seconds` to the response root.

### Client

**New component** `src/components/QuotaPill.tsx`:

```tsx
export function QuotaPill({ remainingSeconds }: { remainingSeconds: number }) {
  if (remainingSeconds > 30) return null;
  const isOver = remainingSeconds <= 0;
  const overBy = -remainingSeconds;

  let text: string;
  if (!isOver) text = ru.inbox.quotaPill.warning(remainingSeconds);
  else if (overBy === 0) text = ru.inbox.quotaPill.over;
  else text = ru.inbox.quotaPill.overBy(overBy);

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 h-5 rounded-full text-[11px] font-medium tabular-nums shrink-0 ${
        isOver
          ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
      aria-label={isOver ? ru.inbox.quotaPill.overAria : ru.inbox.quotaPill.warningAria}
      title={isOver ? ru.inbox.quotaPill.overAria : ru.inbox.quotaPill.warningAria}
    >
      {text}
    </span>
  );
}
```

**InboxList wiring** — pill slots before the timestamp in the row's right-side cluster, `shrink-0` to prevent compression:

```
┌──────────────────────────────────────────────────────────┐
│ [Avatar] Anna     ⏱ Почти лимит · 24с      10:42        │
│          🎙️ Голосовое 0:23                             │
└──────────────────────────────────────────────────────────┘

[Avatar] Boris    ⏰ Превышен · +12с         09:55         ← over by 12
[Avatar] Cathy    ⏰ Лимит достигнут          09:30         ← exactly at cap
```

**ThreadView wiring** — pill inline with the student name in the header, mirroring the inbox visual:

```
┌──────────────────────────────────────────────┐
│ ←  [Avatar]  Anna  ⏱ Почти лимит · 24с  [Card] │
│           trial → 12 июн                     │
├──────────────────────────────────────────────┤
│ ... messages ...                             │
└──────────────────────────────────────────────┘
```

### i18n

New group in `src/lib/i18n/inbox.ts`:

```ts
const quotaPill = {
  warning: (sec: number) => `⏱ Почти лимит · ${sec}с`,
  over: "⏰ Лимит достигнут",
  overBy: (sec: number) => `⏰ Превышен · +${sec}с`,
  warningAria: "Скоро лимит на сегодня",
  overAria: "Лимит на сегодня исчерпан",
};
```

Exported under `ru.inbox.quotaPill.*`.

## Testing

### Unit tests

`tests/quota.test.ts` — extend with:

- `getSignedRemainingForManyToday` returns full quota for users with no usage row today
- Returns negative when usage > cap (over-by)
- Batches a single SELECT per unique tz
- Returns 0 when usage exactly equals cap
- Handles missing tz by defaulting to UTC

No React component test is added. The project currently has no React testing infrastructure (all `tests/*.ts` are pure unit tests of business logic). Standing up jsdom + @testing-library/react for a 30-line pure-render component with four branches is disproportionate — the manual verification matrix below covers the same cases.

### Manual verification

| Scenario | Expected pill |
|---|---|
| Fresh student, no voices today | hidden |
| Student used 100s of 180s cap | hidden (`r=80, >30`) |
| Student used 155s of 180s | amber «Почти лимит · 25с» |
| Student used 180s exactly | red «Лимит достигнут» |
| Student used 195s (grace consumed) | red «Превышен · +15с» |
| Student in `frozen` subscription | hidden (no quota usage → 0 used → full remaining) |
| Student in `trial_expired` | hidden (same reason — gate blocks before quota debit) |
| Admin oversight view, 100 students, 1 tz | exactly 2 queries: tz lookup + 1 batched quota select |
| Admin oversight view, students across 2 tzs | 3 queries: tz lookup + 2 batched quota selects |
| Tutor opens thread of student who's at cap | red pill in header, no other UI change |
| Quota resets at student-local midnight | pill disappears on next inbox refresh after their midnight |

### Inverse cases (per project convention)

- Widen quota (env bump from 180→300) → pill thresholds unchanged (always last 30s); over-by recalculates correctly.
- Narrow quota → students who were just-under become amber on next load.
- Clear: student sends nothing all day → pill hidden.
- Enable: not a settings toggle, always-on (no flag to flip).
- Suppression: subscription state already explains silence (frozen/lapsed/expired) → quota_usage is empty → pill naturally hides; no special-case code.

## Files

### New

- `src/components/QuotaPill.tsx`

### Modified

- `src/server/quota.ts` — add `getSignedRemainingForManyToday`
- `src/app/api/inbox/route.ts` — call helper, decorate each chat with `quota_remaining_seconds`; extend `InboxChat` interface
- `src/app/api/threads/[studentId]/route.ts` — call helper with `[studentId]`, attach `quota_remaining_seconds: number` as a sibling field on the response root JSON (alongside the existing `messages` array — not inside it)
- `src/components/InboxList.tsx` — render `<QuotaPill>` in the row's right-side cluster
- `src/components/ThreadView.tsx` — render `<QuotaPill>` in header next to student name
- `src/lib/i18n/inbox.ts` — add `quotaPill` group
- `tests/quota.test.ts` — extend with helper tests

## Out of scope

- DM to tutor on threshold trip.
- Per-tutor or admin-toggleable setting for the pill.
- Custom thresholds per student.
- Live tick-down inside the chat (pill is stale until next API refresh — acceptable since the inbox is `no-store` and reloads on every open).
- Tutor-side quota analytics ("which students hit the cap most often").
