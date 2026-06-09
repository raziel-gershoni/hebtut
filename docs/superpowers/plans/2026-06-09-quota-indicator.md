# Quota Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a tutor-facing pill in the Mini App that signals when a student is close to or past their daily voice/video quota — visible in the inbox row and in the chat header.

**Architecture:** A new server helper batches `quota_usage` reads per tz group and returns signed remaining seconds per user. `/api/inbox` and `/api/threads/[studentId]` enrich their existing responses with `quota_remaining_seconds`. A single `<QuotaPill>` component (hidden when remaining > 30) renders in both surfaces.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-09-quota-indicator-design.md` (commit `a2e9688`).

---

## Task 1: Server helper `getSignedRemainingForManyToday`

**Files:**
- Modify: `src/server/quota.ts`
- Modify: `tests/quota.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/quota.test.ts`:

```ts
import { computeSignedRemaining } from "@/server/quota";

describe("computeSignedRemaining", () => {
  it("returns full cap when no usage", () => {
    expect(computeSignedRemaining(0, 300)).toBe(300);
  });
  it("subtracts used seconds (positive remaining)", () => {
    expect(computeSignedRemaining(120, 300)).toBe(180);
  });
  it("returns zero when usage equals cap", () => {
    expect(computeSignedRemaining(300, 300)).toBe(0);
  });
  it("returns NEGATIVE when over (no clamping — unlike computeRemaining)", () => {
    expect(computeSignedRemaining(345, 300)).toBe(-45);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- quota.test.ts
```

Expected: 4 new tests fail with `computeSignedRemaining is not a function` or similar import error.

- [ ] **Step 3: Implement the pure helper**

Add to `src/server/quota.ts`, immediately after `computeRemaining`:

```ts
/**
 * Like computeRemaining, but signed — returns NEGATIVE when usage > budget.
 * Used by the tutor-facing quota pill which needs to display over-by amounts.
 * The existing computeRemaining clamps to ≥ 0 (other callers depend on that),
 * so this is a separate function rather than a behavior change.
 */
export function computeSignedRemaining(
  usedSeconds: number,
  budgetSeconds: number,
): number {
  return budgetSeconds - usedSeconds;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- quota.test.ts
```

Expected: all `computeSignedRemaining` tests pass.

- [ ] **Step 5: Implement the batched DB helper**

Add to `src/server/quota.ts`, after `getRemainingForToday`:

```ts
/**
 * Tutor-facing helper. Returns signed remaining seconds today for many users
 * in one shot, batching the quota_usage SELECT per unique timezone. Missing
 * tz → defaults to UTC. Users with no quota_usage row today → full cap.
 * Negative values indicate over-quota by abs(value).
 */
export async function getSignedRemainingForManyToday(
  userIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (userIds.length === 0) return out;

  const sb = getServiceRoleClient();

  const { data: tzRows } = await sb
    .from("users")
    .select("id, tz")
    .in("id", userIds);
  const tzByUser = new Map<number, string>(
    (tzRows ?? []).map((r) => [r.id, r.tz ?? "UTC"]),
  );

  const idsByTz = new Map<string, number[]>();
  for (const id of userIds) {
    const tz = tzByUser.get(id) ?? "UTC";
    const bucket = idsByTz.get(tz) ?? [];
    bucket.push(id);
    idsByTz.set(tz, bucket);
  }

  const usedByUser = new Map<number, number>();
  for (const [tz, ids] of idsByTz) {
    const date = localDateInTz(new Date(), tz);
    const { data } = await sb
      .from("quota_usage")
      .select("student_id, seconds_used")
      .in("student_id", ids)
      .eq("date", date);
    for (const r of data ?? []) {
      usedByUser.set(r.student_id, r.seconds_used);
    }
  }

  for (const id of userIds) {
    out.set(
      id,
      computeSignedRemaining(
        usedByUser.get(id) ?? 0,
        serverEnv.DAILY_QUOTA_SECONDS,
      ),
    );
  }
  return out;
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/quota.ts tests/quota.test.ts
git commit -m "feat(quota): signed-remaining helper + per-tz batched fetcher

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Wire helper into `/api/inbox`

**Files:**
- Modify: `src/app/api/inbox/route.ts`

- [ ] **Step 1: Add field to InboxChat interface**

In `src/app/api/inbox/route.ts`, at the `InboxChat` interface (around line 24), add this field as the last property before the closing brace:

```ts
  /**
   * Signed seconds remaining on this student's daily voice/video-note quota.
   * Negative = over by abs(value). Drives the tutor-facing <QuotaPill>.
   */
  quota_remaining_seconds: number;
```

- [ ] **Step 2: Import the helper**

At the top of `src/app/api/inbox/route.ts`, add to the existing imports:

```ts
import { getSignedRemainingForManyToday } from "@/server/quota";
```

- [ ] **Step 3: Call helper and decorate chats**

Right before the `const chats: InboxChat[] = studentIds.map(...)` block, add:

```ts
  const quotaRemainingByStudent = await getSignedRemainingForManyToday(studentIds);
```

Then inside the `.map((sid): InboxChat => { ... return { ... } })` return block, add this field alongside the existing ones (e.g., right after `claim: ...`):

```ts
        quota_remaining_seconds: quotaRemainingByStudent.get(sid) ?? 0,
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all 101 tests pass (97 existing + 4 new from Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/inbox/route.ts
git commit -m "feat(inbox): include signed quota remaining per row

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Wire helper into `/api/threads/[studentId]`

**Files:**
- Modify: `src/app/api/threads/[studentId]/route.ts`

- [ ] **Step 1: Import the helper**

At the top of `src/app/api/threads/[studentId]/route.ts`, add:

```ts
import { getSignedRemainingForManyToday } from "@/server/quota";
```

- [ ] **Step 2: Call helper for the single student**

Just before the final `return Response.json(...)` line (currently line 189), add:

```ts
  const quotaMap = await getSignedRemainingForManyToday([studentId]);
  const quota_remaining_seconds = quotaMap.get(studentId) ?? 0;
```

- [ ] **Step 3: Update the return statement**

Replace the existing return:

```ts
  return Response.json({ messages, claim, student }, { headers: noStoreHeaders });
```

with:

```ts
  return Response.json(
    { messages, claim, student, quota_remaining_seconds },
    { headers: noStoreHeaders },
  );
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/threads/[studentId]/route.ts
git commit -m "feat(threads): include signed quota remaining on response root

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: i18n keys for `quotaPill`

**Files:**
- Modify: `src/lib/i18n/inbox.ts`

- [ ] **Step 1: Add the quotaPill group**

In `src/lib/i18n/inbox.ts`, after the existing `row` group (around line 24), add this new group:

```ts
const quotaPill = {
  warning: (sec: number) => `⏱ Почти лимит · ${sec}с`,
  over: "⏰ Лимит достигнут",
  overBy: (sec: number) => `⏰ Превышен · +${sec}с`,
  warningAria: "Скоро лимит на сегодня",
  overAria: "Лимит на сегодня исчерпан",
};
```

- [ ] **Step 2: Export it under `ru.inbox.quotaPill`**

Find the `export const inbox = {` block at the bottom of the file. Add `quotaPill,` to the keys list.

For example, if the export looks like:

```ts
export const inbox = {
  dateSeparator,
  row,
  inboxPage,
  ...
};
```

Make it:

```ts
export const inbox = {
  dateSeparator,
  row,
  quotaPill,
  inboxPage,
  ...
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/inbox.ts
git commit -m "feat(i18n): add inbox.quotaPill copy

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Create `<QuotaPill>` component

**Files:**
- Create: `src/components/QuotaPill.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/QuotaPill.tsx`:

```tsx
import { ru } from "@/lib/i18n";

/**
 * Tutor-facing pill that signals a student is close to (≤30s) or past their
 * daily voice/video-note quota. Hidden when remaining > 30. Amber for the
 * warning band, red for at-or-over. The over-by amount is shown when the
 * student has gone past their cap (grace already consumed or large message).
 */
export function QuotaPill({ remainingSeconds }: { remainingSeconds: number }) {
  if (remainingSeconds > 30) return null;
  const isOver = remainingSeconds <= 0;
  const overBy = -remainingSeconds;

  let text: string;
  if (!isOver) {
    text = ru.inbox.quotaPill.warning(remainingSeconds);
  } else if (overBy === 0) {
    text = ru.inbox.quotaPill.over;
  } else {
    text = ru.inbox.quotaPill.overBy(overBy);
  }

  const aria = isOver
    ? ru.inbox.quotaPill.overAria
    : ru.inbox.quotaPill.warningAria;

  return (
    <span
      aria-label={aria}
      title={aria}
      className={`inline-flex items-center gap-1 px-2 h-5 rounded-full text-[11px] font-medium tabular-nums shrink-0 ${
        isOver
          ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/QuotaPill.tsx
git commit -m "feat(quota-pill): tutor-facing daily-quota indicator component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Render `<QuotaPill>` in InboxList rows

**Files:**
- Modify: `src/components/InboxList.tsx`

- [ ] **Step 1: Add field to Chat interface**

In `src/components/InboxList.tsx`, find the `interface Chat` (around line 23). Add this field after the existing `claim` property, immediately before the closing `}`:

```ts
  /**
   * Mirror of /api/inbox `quota_remaining_seconds`. Optional on the client
   * so an old server response (without the field) doesn't blow up — treated
   * as no-pill in that case.
   */
  quota_remaining_seconds?: number;
```

- [ ] **Step 2: Import QuotaPill**

In the imports at the top of `src/components/InboxList.tsx`, add:

```ts
import { QuotaPill } from "./QuotaPill";
```

- [ ] **Step 3: Render the pill in the row's right-side cluster**

In the same file, find the time-rendering block (around line 261):

```tsx
            {time && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-tg-text-hint">
                {time}
              </span>
            )}
```

Replace it with:

```tsx
            {chat.quota_remaining_seconds != null && (
              <span className="ml-auto shrink-0">
                <QuotaPill remainingSeconds={chat.quota_remaining_seconds} />
              </span>
            )}
            {time && (
              <span
                className={`${chat.quota_remaining_seconds != null ? "" : "ml-auto "}shrink-0 text-[11px] tabular-nums text-tg-text-hint`}
              >
                {time}
              </span>
            )}
```

Note: only one element gets `ml-auto`. When the pill is present it owns the right-push; the time follows. When the pill is absent, time keeps its original `ml-auto`.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/InboxList.tsx
git commit -m "feat(inbox-list): render QuotaPill in chat row

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Render `<QuotaPill>` in ThreadView header

**Files:**
- Modify: `src/components/ThreadView.tsx`

- [ ] **Step 1: Add state for quota remaining**

In `src/components/ThreadView.tsx`, find the state declarations (around line 57–60). Add a new state variable after `setStudent`:

```ts
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
```

- [ ] **Step 2: Extend the fetch response type**

In the same file, find the `const load = useCallback(async () => { ... })` block (around line 70). Update the response type:

Replace:

```ts
    const d = (await r.json()) as {
      messages: ApiMessage[];
      claim?: ClaimInfo | null;
      student?: StudentMeta | null;
    };
    setMessages(d.messages);
    setClaim(d.claim ?? null);
    setStudent(d.student ?? null);
```

with:

```ts
    const d = (await r.json()) as {
      messages: ApiMessage[];
      claim?: ClaimInfo | null;
      student?: StudentMeta | null;
      quota_remaining_seconds?: number;
    };
    setMessages(d.messages);
    setClaim(d.claim ?? null);
    setStudent(d.student ?? null);
    setQuotaRemaining(d.quota_remaining_seconds ?? null);
```

- [ ] **Step 3: Import QuotaPill**

Add to the imports at the top of `src/components/ThreadView.tsx`:

```ts
import { QuotaPill } from "./QuotaPill";
```

- [ ] **Step 4: Render pill inline with the student name**

In the header block (around line 358–362), find:

```tsx
          <div className="min-w-0 flex-1 leading-tight text-left">
            <div className="font-semibold tracking-tight truncate">{studentDisplay}</div>
            <div className="text-xs text-tg-text-hint">{ru.inbox.thread.studentRoleLabel}</div>
          </div>
```

Replace with:

```tsx
          <div className="min-w-0 flex-1 leading-tight text-left">
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight truncate">{studentDisplay}</span>
              {quotaRemaining != null && <QuotaPill remainingSeconds={quotaRemaining} />}
            </div>
            <div className="text-xs text-tg-text-hint">{ru.inbox.thread.studentRoleLabel}</div>
          </div>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ThreadView.tsx
git commit -m "feat(thread-view): render QuotaPill in chat header

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Full verification + push

- [ ] **Step 1: Run the full test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: clean typecheck + 101 tests passing.

- [ ] **Step 2: Smoke-check manual matrix**

Spin up the dev server and walk these (logged in as a tutor or admin):

| Scenario | Expected pill |
|---|---|
| Student with no voices today | hidden in inbox + chat |
| Student with 155s of 180s used | amber «Почти лимит · 25с» |
| Student with 180s of 180s used | red «Лимит достигнут» |
| Student with 195s used (over by 15) | red «Превышен · +15с» |
| Student in `frozen` subscription | hidden |
| Open the student's thread | pill mirrors in header |

If anything misbehaves, stop and diagnose before pushing.

- [ ] **Step 3: Push**

```bash
git push
```

Expected: 7 commits land on `origin/main` cleanly.
