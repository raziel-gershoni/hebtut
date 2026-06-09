# Tutor Work-Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-collection pipeline + admin viewer for tutor work-time billing. Mini App heartbeats, playback events, and webhook-sourced recording events feed a single event log; the admin viewer queries it through a pure interval-merge algorithm to produce non-double-counted per-bucket totals.

**Architecture:** Append-only event log `tutor_work_events` (active / playback / recording, each an interval). Server merges overlapping intervals at read time by priority `recording > playback > active`. Pure TS interval-math helpers are unit-tested; route validation extracts pure helpers in the Task 1 quota pattern.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase, vitest, Tailwind, grammY (TG bot).

**Spec:** `docs/superpowers/specs/2026-06-09-tutor-work-time-design.md` (commit `27c55f9`).

---

## Task 1: Migration — `tutor_work_events` table

**Files:**
- Create: `supabase/migrations/20260609000002_tutor_work_events.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260609000002_tutor_work_events.sql
git commit -m "feat(db): tutor_work_events event log for billing-grade work-time

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Pure interval helpers + tests (TDD)

**Files:**
- Create: `src/server/tutor-work.ts`
- Create: `tests/tutor-work-merge.test.ts`

- [ ] **Step 1: Write all failing tests**

Create `tests/tutor-work-merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  mergeIntervals,
  subtractIntervals,
  intervalsDurationS,
  computeWorkBuckets,
  applyDailyCap,
  type Interval,
} from "@/server/tutor-work";

const iv = (start: number, end: number): Interval => ({ start, end });

describe("mergeIntervals", () => {
  it("empty → empty", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
  it("single → single", () => {
    expect(mergeIntervals([iv(0, 10)])).toEqual([iv(0, 10)]);
  });
  it("two disjoint → both", () => {
    expect(mergeIntervals([iv(0, 5), iv(10, 15)])).toEqual([iv(0, 5), iv(10, 15)]);
  });
  it("two touching at boundary → merged", () => {
    expect(mergeIntervals([iv(0, 5), iv(5, 10)])).toEqual([iv(0, 10)]);
  });
  it("two overlapping → merged with max end", () => {
    expect(mergeIntervals([iv(0, 7), iv(5, 10)])).toEqual([iv(0, 10)]);
  });
  it("three with chain merge → single", () => {
    expect(mergeIntervals([iv(0, 5), iv(3, 8), iv(7, 12)])).toEqual([iv(0, 12)]);
  });
  it("unsorted input → still correct", () => {
    expect(mergeIntervals([iv(10, 15), iv(0, 5), iv(20, 25)])).toEqual([
      iv(0, 5),
      iv(10, 15),
      iv(20, 25),
    ]);
  });
  it("zero-length interval → dropped", () => {
    expect(mergeIntervals([iv(5, 5), iv(0, 10)])).toEqual([iv(0, 10)]);
  });
});

describe("subtractIntervals", () => {
  it("empty base → empty", () => {
    expect(subtractIntervals([], [iv(0, 5)])).toEqual([]);
  });
  it("empty toRemove → base unchanged", () => {
    expect(subtractIntervals([iv(0, 10)], [])).toEqual([iv(0, 10)]);
  });
  it("toRemove fully covers base → empty", () => {
    expect(subtractIntervals([iv(2, 8)], [iv(0, 10)])).toEqual([]);
  });
  it("partial overlap at start → trimmed left", () => {
    expect(subtractIntervals([iv(5, 15)], [iv(0, 8)])).toEqual([iv(8, 15)]);
  });
  it("partial overlap at end → trimmed right", () => {
    expect(subtractIntervals([iv(0, 10)], [iv(7, 15)])).toEqual([iv(0, 7)]);
  });
  it("toRemove inside base → base split into two", () => {
    expect(subtractIntervals([iv(0, 20)], [iv(5, 10)])).toEqual([
      iv(0, 5),
      iv(10, 20),
    ]);
  });
  it("multiple holes punched", () => {
    expect(
      subtractIntervals([iv(0, 30)], [iv(5, 10), iv(15, 20)]),
    ).toEqual([iv(0, 5), iv(10, 15), iv(20, 30)]);
  });
  it("disjoint toRemove → base unchanged", () => {
    expect(subtractIntervals([iv(10, 20)], [iv(0, 5), iv(25, 30)])).toEqual([
      iv(10, 20),
    ]);
  });
});

describe("intervalsDurationS", () => {
  it("empty → 0", () => {
    expect(intervalsDurationS([])).toBe(0);
  });
  it("sums lengths in seconds", () => {
    expect(intervalsDurationS([iv(0, 5000), iv(10000, 15000)])).toBe(10);
  });
});

describe("computeWorkBuckets", () => {
  const t = (s: number) => new Date(s * 1000);
  const ev = (kind: "active" | "playback" | "recording", from: number, to: number) => ({
    kind,
    started_at: t(from),
    ended_at: t(to),
  });

  it("all empty → all zeros", () => {
    expect(computeWorkBuckets([])).toEqual({
      recording_s: 0,
      playback_s: 0,
      active_s: 0,
      total_s: 0,
    });
  });
  it("recording only → recording_s = total", () => {
    const r = computeWorkBuckets([ev("recording", 0, 30)]);
    expect(r).toEqual({ recording_s: 30, playback_s: 0, active_s: 0, total_s: 30 });
  });
  it("playback only → playback_s = total", () => {
    const r = computeWorkBuckets([ev("playback", 0, 45)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 45, active_s: 0, total_s: 45 });
  });
  it("active only → active_s = total", () => {
    const r = computeWorkBuckets([ev("active", 0, 60)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 0, active_s: 60, total_s: 60 });
  });
  it("playback overlaps active → active = playback-free remainder", () => {
    const r = computeWorkBuckets([ev("active", 0, 60), ev("playback", 10, 30)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 20, active_s: 40, total_s: 60 });
  });
  it("recording overlaps playback → playback = recording-free remainder", () => {
    const r = computeWorkBuckets([ev("playback", 0, 30), ev("recording", 10, 20)]);
    expect(r).toEqual({ recording_s: 10, playback_s: 20, active_s: 0, total_s: 30 });
  });
  it("ladder: active 0-60, playback 30-45, recording 40-42", () => {
    const r = computeWorkBuckets([
      ev("active", 0, 60),
      ev("playback", 30, 45),
      ev("recording", 40, 42),
    ]);
    expect(r).toEqual({ recording_s: 2, playback_s: 13, active_s: 45, total_s: 60 });
  });
});

describe("applyDailyCap", () => {
  it("no clamp when under cap", () => {
    expect(
      applyDailyCap(
        { recording_s: 100, playback_s: 200, active_s: 300, total_s: 600 },
        16 * 3600,
      ),
    ).toEqual({ recording_s: 100, playback_s: 200, active_s: 300, total_s: 600 });
  });
  it("clamps total proportionally when over cap", () => {
    const r = applyDailyCap(
      { recording_s: 1000, playback_s: 2000, active_s: 7000, total_s: 10000 },
      5000,
    );
    expect(r.total_s).toBe(5000);
    expect(r.recording_s + r.playback_s + r.active_s).toBe(5000);
    expect(r.recording_s).toBe(500);
    expect(r.playback_s).toBe(1000);
    expect(r.active_s).toBe(3500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tutor-work-merge.test.ts
```

Expected: all fail with module-not-found.

- [ ] **Step 3: Implement helpers**

Create `src/server/tutor-work.ts`:

```ts
export type Interval = { start: number; end: number };

type WorkEvent = {
  kind: "active" | "playback" | "recording";
  started_at: Date;
  ended_at: Date;
};

export type WorkBuckets = {
  recording_s: number;
  playback_s: number;
  active_s: number;
  total_s: number;
};

export function mergeIntervals(raw: Interval[]): Interval[] {
  const filtered = raw.filter((i) => i.end > i.start);
  if (filtered.length === 0) return [];
  const sorted = [...filtered].sort((a, b) => a.start - b.start);
  const out: Interval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function subtractIntervals(
  base: Interval[],
  toRemove: Interval[],
): Interval[] {
  if (base.length === 0) return [];
  if (toRemove.length === 0) return base.map((i) => ({ ...i }));
  const removeMerged = mergeIntervals(toRemove);
  const out: Interval[] = [];
  for (const b of base) {
    let cursor = b.start;
    for (const r of removeMerged) {
      if (r.end <= cursor) continue;
      if (r.start >= b.end) break;
      if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, b.end) });
      cursor = Math.max(cursor, r.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) out.push({ start: cursor, end: b.end });
  }
  return out;
}

export function intervalsDurationS(ivs: Interval[]): number {
  return ivs.reduce((s, i) => s + (i.end - i.start), 0) / 1000;
}

export function computeWorkBuckets(events: WorkEvent[]): WorkBuckets {
  const toIv = (e: WorkEvent): Interval => ({
    start: e.started_at.getTime(),
    end: e.ended_at.getTime(),
  });
  const byKind = {
    recording: [] as Interval[],
    playback: [] as Interval[],
    active: [] as Interval[],
  };
  for (const e of events) byKind[e.kind].push(toIv(e));

  const recording = mergeIntervals(byKind.recording);
  const playback = subtractIntervals(mergeIntervals(byKind.playback), recording);
  const active = subtractIntervals(
    subtractIntervals(mergeIntervals(byKind.active), recording),
    playback,
  );

  const recording_s = intervalsDurationS(recording);
  const playback_s = intervalsDurationS(playback);
  const active_s = intervalsDurationS(active);
  return {
    recording_s,
    playback_s,
    active_s,
    total_s: recording_s + playback_s + active_s,
  };
}

export function applyDailyCap(buckets: WorkBuckets, capSeconds: number): WorkBuckets {
  if (buckets.total_s <= capSeconds) return buckets;
  const ratio = capSeconds / buckets.total_s;
  const recording_s = Math.round(buckets.recording_s * ratio);
  const playback_s = Math.round(buckets.playback_s * ratio);
  const active_s = capSeconds - recording_s - playback_s;
  return { recording_s, playback_s, active_s, total_s: capSeconds };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tutor-work-merge.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/tutor-work.ts tests/tutor-work-merge.test.ts
git commit -m "feat(tutor-work): pure interval helpers + merge algorithm

mergeIntervals, subtractIntervals, computeWorkBuckets, applyDailyCap.
Priority-based merge (recording > playback > active) ensures each second
is credited to exactly one kind. Daily-cap clamps proportionally.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Playback validation helper + tests (TDD)

**Files:**
- Create: `src/server/tutor-work-validation.ts`
- Create: `tests/tutor-work-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tutor-work-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePlayback, type PlaybackInput } from "@/server/tutor-work-validation";

const t = (s: number) => new Date(s * 1000);

const baseMessage = {
  id: 100,
  direction: "in" as const,
  kind: "voice" as const,
  duration: 30,
  student_id: 7,
};

const baseActiveWindow = [{ started_at: t(0), ended_at: t(60) }];

const validInput: PlaybackInput = {
  message: baseMessage,
  tutorIsLinkedToStudent: true,
  activeWindows: baseActiveWindow,
  started_at: t(5),
  ended_at: t(20),
};

describe("validatePlayback", () => {
  it("accepts a valid playback within an active window", () => {
    const r = validatePlayback(validInput);
    expect(r).toEqual({
      ok: true,
      student_id: 7,
      started_at: t(5),
      ended_at: t(20),
    });
  });

  it("rejects when no overlapping active heartbeat", () => {
    const r = validatePlayback({ ...validInput, activeWindows: [] });
    expect(r).toEqual({ ok: false, reason: "no-active-overlap" });
  });

  it("rejects when message is outbound (not inbound from student)", () => {
    const r = validatePlayback({
      ...validInput,
      message: { ...baseMessage, direction: "out" },
    });
    expect(r).toEqual({ ok: false, reason: "outbound-message" });
  });

  it("rejects when tutor not linked to student", () => {
    const r = validatePlayback({ ...validInput, tutorIsLinkedToStudent: false });
    expect(r).toEqual({ ok: false, reason: "not-linked" });
  });

  it("rejects when message kind is text (not voice/video_note)", () => {
    const r = validatePlayback({
      ...validInput,
      // @ts-expect-error — testing runtime guard
      message: { ...baseMessage, kind: "text" },
    });
    expect(r).toEqual({ ok: false, reason: "not-playable" });
  });

  it("clamps duration when claimed > message duration", () => {
    const r = validatePlayback({
      ...validInput,
      started_at: t(0),
      ended_at: t(50), // claim 50s on a 30s file
    });
    expect(r).toEqual({
      ok: true,
      student_id: 7,
      started_at: t(0),
      ended_at: t(30),
    });
  });

  it("rejects when ended_at < started_at", () => {
    const r = validatePlayback({
      ...validInput,
      started_at: t(20),
      ended_at: t(10),
    });
    expect(r).toEqual({ ok: false, reason: "invalid-range" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tutor-work-validation.test.ts
```

Expected: all fail with module-not-found.

- [ ] **Step 3: Implement validator**

Create `src/server/tutor-work-validation.ts`:

```ts
export type PlaybackInput = {
  message: {
    id: number;
    direction: "in" | "out";
    kind: "voice" | "video_note" | "text";
    duration: number;
    student_id: number;
  } | null;
  tutorIsLinkedToStudent: boolean;
  activeWindows: { started_at: Date; ended_at: Date }[];
  started_at: Date;
  ended_at: Date;
};

export type PlaybackResult =
  | { ok: true; student_id: number; started_at: Date; ended_at: Date }
  | {
      ok: false;
      reason:
        | "no-message"
        | "outbound-message"
        | "not-playable"
        | "not-linked"
        | "invalid-range"
        | "no-active-overlap";
    };

export function validatePlayback(input: PlaybackInput): PlaybackResult {
  const { message, tutorIsLinkedToStudent, activeWindows, started_at } = input;

  if (!message) return { ok: false, reason: "no-message" };
  if (message.direction !== "in") return { ok: false, reason: "outbound-message" };
  if (message.kind !== "voice" && message.kind !== "video_note") {
    return { ok: false, reason: "not-playable" };
  }
  if (!tutorIsLinkedToStudent) return { ok: false, reason: "not-linked" };

  if (input.ended_at.getTime() < started_at.getTime()) {
    return { ok: false, reason: "invalid-range" };
  }

  const claimedMs = input.ended_at.getTime() - started_at.getTime();
  const maxMs = message.duration * 1000;
  const ended_at = claimedMs > maxMs
    ? new Date(started_at.getTime() + maxMs)
    : input.ended_at;

  const hasOverlap = activeWindows.some(
    (w) =>
      w.ended_at.getTime() > started_at.getTime() &&
      w.started_at.getTime() < ended_at.getTime(),
  );
  if (!hasOverlap) return { ok: false, reason: "no-active-overlap" };

  return { ok: true, student_id: message.student_id, started_at, ended_at };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tutor-work-validation.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/tutor-work-validation.ts tests/tutor-work-validation.test.ts
git commit -m "feat(tutor-work): pure playback validation helper

Validates: message exists, inbound, voice/video_note kind, tutor linked,
range valid, overlap with active heartbeat. Clamps claimed duration to
message duration. Pure for testability without Supabase mocking.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Heartbeat env var + endpoint

**Files:**
- Modify: `src/lib/env.ts`
- Create: `src/app/api/tutor-work/heartbeat/route.ts`

- [ ] **Step 1: Add env var**

In `src/lib/env.ts`, add `WORK_HEARTBEAT_CADENCE_SEC` to the `serverEnv` schema with default `30`:

```ts
// In the z.object({...}) for server env, add:
  WORK_HEARTBEAT_CADENCE_SEC: z.coerce.number().int().positive().default(30),
```

- [ ] **Step 2: Create the endpoint**

Create `src/app/api/tutor-work/heartbeat/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/tutor-work/heartbeat
 *
 * Tutor's Mini App pings here every WORK_HEARTBEAT_CADENCE_SEC while the
 * app is active, focused, and the user is not idle. Server inserts one
 * `active` interval per ping; the merge step at read-time collapses
 * contiguous pings into a single interval.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!user) return new Response("unauthorized", { status: 401, headers: noStoreHeaders });
  if (user.role !== "teacher" && !user.isAdmin) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  const now = new Date();
  const started = new Date(now.getTime() - serverEnv.WORK_HEARTBEAT_CADENCE_SEC * 1000);

  const sb = getServiceRoleClient();
  const { error } = await sb.from("tutor_work_events").insert({
    tutor_id: user.id,
    kind: "active",
    started_at: started.toISOString(),
    ended_at: now.toISOString(),
    ref_id: null,
    source: "heartbeat",
  });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts src/app/api/tutor-work/heartbeat/route.ts
git commit -m "feat(tutor-work): heartbeat endpoint

POST /api/tutor-work/heartbeat inserts one 'active' interval per call.
Cadence is env-configurable via WORK_HEARTBEAT_CADENCE_SEC (default 30s).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Playback endpoint

**Files:**
- Create: `src/app/api/tutor-work/playback/route.ts`

- [ ] **Step 1: Create the endpoint**

Create `src/app/api/tutor-work/playback/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { validatePlayback } from "@/server/tutor-work-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  messageId: z.coerce.number().int(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
});

/**
 * POST /api/tutor-work/playback
 *
 * Logs a tutor's playback of an inbound student voice/video_note in the
 * Mini App. Validated server-side: message must exist, be inbound, of a
 * playable kind, the tutor must be linked to the student, and the
 * playback window must overlap an existing 'active' heartbeat.
 *
 * Always returns 200 — failures are silently dropped (logged server-side)
 * so the UX doesn't show errors for what is otherwise an analytics signal.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!user || (user.role !== "teacher" && !user.isAdmin)) {
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }

  const { messageId } = parsed.data;
  const started_at = new Date(parsed.data.started_at);
  const ended_at = new Date(parsed.data.ended_at);

  const sb = getServiceRoleClient();

  const { data: msg } = await sb
    .from("messages")
    .select("id, direction, kind, duration, student_id")
    .eq("id", messageId)
    .maybeSingle();

  let tutorIsLinkedToStudent = false;
  if (msg) {
    if (user.isAdmin) {
      tutorIsLinkedToStudent = true;
    } else {
      const { data: link } = await sb
        .from("student_teachers")
        .select("teacher_id")
        .eq("student_id", msg.student_id)
        .eq("teacher_id", user.id)
        .maybeSingle();
      tutorIsLinkedToStudent = !!link;
    }
  }

  // Pull active windows that *could* overlap. Cheap range filter.
  const { data: actives } = await sb
    .from("tutor_work_events")
    .select("started_at, ended_at")
    .eq("tutor_id", user.id)
    .eq("kind", "active")
    .gte("ended_at", started_at.toISOString())
    .lte("started_at", ended_at.toISOString());

  const result = validatePlayback({
    message: msg as
      | {
          id: number;
          direction: "in" | "out";
          kind: "voice" | "video_note" | "text";
          duration: number;
          student_id: number;
        }
      | null,
    tutorIsLinkedToStudent,
    activeWindows: (actives ?? []).map((a) => ({
      started_at: new Date(a.started_at),
      ended_at: new Date(a.ended_at),
    })),
    started_at,
    ended_at,
  });

  if (!result.ok) {
    console.warn("[tutor-work/playback] dropped", {
      reason: result.reason,
      tutor_id: user.id,
      messageId,
    });
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }

  const { error } = await sb.from("tutor_work_events").insert({
    tutor_id: user.id,
    kind: "playback",
    started_at: result.started_at.toISOString(),
    ended_at: result.ended_at.toISOString(),
    ref_id: result.student_id,
    source: "playback_provider",
  });
  if (error) {
    console.warn("[tutor-work/playback] insert failed", {
      tutor_id: user.id,
      messageId,
      err: error.message,
    });
  }
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tutor-work/playback/route.ts
git commit -m "feat(tutor-work): playback endpoint with server-side validation

Uses pure validatePlayback helper. Fail-soft: returns 200 with ok=false on
any failure (auth, parse, validation) and logs server-side. Caps duration
at message file length; requires overlap with an active heartbeat.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Wire recording event into `teacher-reply.ts`

**Files:**
- Modify: `src/server/handlers/teacher-reply.ts`

- [ ] **Step 1: Insert recording event right after duration is read**

In `src/server/handlers/teacher-reply.ts`, find the existing line `const duration = (voice?.duration ?? note?.duration ?? 0) as number;` (around line 155).

Add immediately after it:

```ts
  // Record the recording-work event. Sized by the file duration from the
  // TG webhook (server-authoritative — tutor can't tamper). Fires here,
  // before the immediate/scheduled branching, so scheduled outbound also
  // credits the recording work to "now" (when it happened) rather than
  // delivery time.
  if (duration > 0) {
    const recEnd = new Date();
    const recStart = new Date(recEnd.getTime() - duration * 1000);
    await sb.from("tutor_work_events").insert({
      tutor_id: teacher.id,
      kind: "recording",
      started_at: recStart.toISOString(),
      ended_at: recEnd.toISOString(),
      ref_id: prompt.student_id,
      source: "tg_webhook",
    });
  }
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/handlers/teacher-reply.ts
git commit -m "feat(tutor-work): credit recording from webhook duration

Inserted in teacher-reply.ts right after duration is read from the webhook
payload — credits both immediate and scheduled outbound, since the recording
work happened when the tutor recorded it, not when it's delivered.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Client hook `useWorkHeartbeat`

**Files:**
- Create: `src/hooks/useWorkHeartbeat.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useWorkHeartbeat.ts`:

```ts
"use client";
import { useEffect, useRef } from "react";

const CADENCE_MS = 30_000;
const IDLE_MS = 2 * 60 * 1000;

interface TelegramWebApp {
  isActive?: boolean;
  onEvent?: (name: string, cb: () => void) => void;
  offEvent?: (name: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * Heartbeat hook for tutor work-time tracking. Mounts in InboxList and
 * ThreadView. Posts to /api/tutor-work/heartbeat every 30s while:
 *   - hook is enabled (caller decides — typically role === "teacher")
 *   - TG WebApp.isActive is true (Mini App focused among open ones)
 *   - document.visibilityState is "visible"
 *   - user is not idle (input within last 2 min)
 *
 * Flushes a final heartbeat on TG `deactivated` and on `beforeunload` via
 * navigator.sendBeacon. Skips fire on mount until a tick passes so duplicate
 * mounts (StrictMode) don't double-credit.
 */
export function useWorkHeartbeat(enabled: boolean, jwt: string): void {
  const lastInputRef = useRef<number>(Date.now());
  const tgActiveRef = useRef<boolean>(true);

  // Track user input to derive idle state
  useEffect(() => {
    if (!enabled) return;
    const onInput = () => {
      lastInputRef.current = Date.now();
    };
    const events = ["scroll", "click", "keydown", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, onInput, { passive: true }),
    );
    return () =>
      events.forEach((e) => window.removeEventListener(e, onInput));
  }, [enabled]);

  // Track TG active state. Defaults to true if TG SDK unavailable (dev mode).
  useEffect(() => {
    if (!enabled) return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tgActiveRef.current = tg.isActive ?? true;
    const onActivated = () => {
      tgActiveRef.current = true;
    };
    const onDeactivated = () => {
      tgActiveRef.current = false;
      // Best-effort flush on deactivate
      try {
        navigator.sendBeacon(
          "/api/tutor-work/heartbeat",
          new Blob(
            [JSON.stringify({})],
            { type: "application/json" },
          ),
        );
      } catch {
        // sendBeacon may be unavailable; ignore
      }
    };
    tg.onEvent?.("activated", onActivated);
    tg.onEvent?.("deactivated", onDeactivated);
    return () => {
      tg.offEvent?.("activated", onActivated);
      tg.offEvent?.("deactivated", onDeactivated);
    };
  }, [enabled]);

  // Heartbeat tick
  useEffect(() => {
    if (!enabled) return;
    const send = async () => {
      try {
        await fetch("/api/tutor-work/heartbeat", {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
        });
      } catch {
        // Network errors are fine — next tick will retry
      }
    };
    const tick = () => {
      const idle = Date.now() - lastInputRef.current > IDLE_MS;
      const visible = document.visibilityState === "visible";
      if (!idle && tgActiveRef.current && visible) {
        void send();
      }
    };
    const id = window.setInterval(tick, CADENCE_MS);
    return () => window.clearInterval(id);
  }, [enabled, jwt]);

  // Best-effort flush on unload
  useEffect(() => {
    if (!enabled) return;
    const onUnload = () => {
      try {
        navigator.sendBeacon(
          "/api/tutor-work/heartbeat",
          new Blob([JSON.stringify({})], { type: "application/json" }),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [enabled]);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkHeartbeat.ts
git commit -m "feat(tutor-work): useWorkHeartbeat client hook

30s heartbeats while TG isActive + document visible + user not idle (2min).
Flushes on TG 'deactivated' and 'beforeunload' via navigator.sendBeacon.
Defaults TG-isActive to true when SDK absent (dev mode).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Mount `useWorkHeartbeat` in InboxList + ThreadView

**Files:**
- Modify: `src/components/InboxList.tsx`
- Modify: `src/components/ThreadView.tsx`

- [ ] **Step 1: Mount in InboxList**

In `src/components/InboxList.tsx`, add to imports:

```ts
import { useWorkHeartbeat } from "@/hooks/useWorkHeartbeat";
```

Then inside the `InboxList` function component, immediately after the existing state declarations (around the `useState(...)` block):

```ts
  useWorkHeartbeat(role === "teacher", jwt);
```

- [ ] **Step 2: Mount in ThreadView**

In `src/components/ThreadView.tsx`, add to imports:

```ts
import { useWorkHeartbeat } from "@/hooks/useWorkHeartbeat";
```

Inside the `ThreadView` function component, alongside the existing state declarations:

```ts
  useWorkHeartbeat(role === "teacher", jwt);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/InboxList.tsx src/components/ThreadView.tsx
git commit -m "feat(tutor-work): mount useWorkHeartbeat in inbox + thread

Only fires when role === 'teacher' — admins reviewing the panel don't
generate heartbeats per the scope decision.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: PlaybackProvider integration — POST playback on endPlay

**Files:**
- Modify: `src/components/PlaybackProvider.tsx`

- [ ] **Step 1: Wrap startPlay/endPlay with timing + POST**

In `src/components/PlaybackProvider.tsx`, find the existing `PlaybackProvider` props and add a `jwt: string` prop. Find the `PlaybackProvider` function. Update its signature to:

```ts
export function PlaybackProvider({
  messages,
  jwt,
  children,
}: {
  messages: PlayableMessage[];
  jwt: string;
  children: ReactNode;
}) {
```

Then find the existing `startPlay` and `endPlay` callbacks. Add a ref to track the start timestamp per message, and POST to the playback endpoint on `endPlay`:

```ts
  const playStartRef = useRef<{ id: number; startedAt: number } | null>(null);

  const startPlay = useCallback((id: number) => {
    playStartRef.current = { id, startedAt: Date.now() };
    setCurrentMessageId(id);
  }, []);

  const endPlay = useCallback(
    (id: number) => {
      setLastEndedAt(Date.now());
      // Flush playback event server-side. Fail-soft — UX doesn't depend on it.
      const start = playStartRef.current;
      if (start && start.id === id) {
        const startedAt = new Date(start.startedAt).toISOString();
        const endedAt = new Date().toISOString();
        playStartRef.current = null;
        void fetch("/api/tutor-work/playback", {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageId: id,
            started_at: startedAt,
            ended_at: endedAt,
          }),
        }).catch(() => {
          // Network errors are dropped — the playback signal is best-effort
        });
      }
      const idx = playable.findIndex((p) => p.id === id);
      const next =
        idx >= 0 && idx < playable.length - 1 ? playable[idx + 1]! : null;
      setCurrentMessageId(next ? next.id : null);
    },
    [playable, jwt],
  );
```

Add `useRef` to the import line at the top of the file if not already present.

- [ ] **Step 2: Update all `<PlaybackProvider>` callers to pass jwt**

Find every render of `<PlaybackProvider`:

```bash
grep -rn "<PlaybackProvider" src/
```

For each call site, add `jwt={jwt}`. The expected single call site is in `src/components/ThreadView.tsx`:

```tsx
    <PlaybackProvider messages={messages} jwt={jwt}>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaybackProvider.tsx src/components/ThreadView.tsx
git commit -m "feat(tutor-work): POST playback event on endPlay

PlaybackProvider tracks per-message play-start timestamp and posts to
/api/tutor-work/playback when playback ends. Fail-soft network errors.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Admin API `GET /api/admin/tutor-work`

**Files:**
- Create: `src/app/api/admin/tutor-work/route.ts`

- [ ] **Step 1: Create the endpoint**

Create `src/app/api/admin/tutor-work/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { localDateInTz } from "@/lib/time";
import {
  applyDailyCap,
  computeWorkBuckets,
  type WorkBuckets,
} from "@/server/tutor-work";
import { addDays, format, parseISO } from "date-fns";
import { zonedTimeToUtc } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAILY_CAP_SEC = 16 * 3600;

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tutorId: z.coerce.number().int().optional(),
});

interface DayBucket extends WorkBuckets {
  date: string;
}

interface TutorRollup {
  tutor_id: number;
  tutor_name: string;
  tutor_has_avatar: boolean;
  days: DayBucket[];
  totals: WorkBuckets;
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    tutorId: url.searchParams.get("tutorId") ?? undefined,
  });
  if (!parsed.success) {
    return new Response("bad query", { status: 400, headers: noStoreHeaders });
  }

  const tz = user.tz ?? "UTC";
  const fromDayStart = zonedTimeToUtc(`${parsed.data.from}T00:00:00`, tz);
  const toDayEnd = zonedTimeToUtc(
    `${format(addDays(parseISO(parsed.data.to), 1), "yyyy-MM-dd")}T00:00:00`,
    tz,
  );

  const sb = getServiceRoleClient();

  let query = sb
    .from("tutor_work_events")
    .select("tutor_id, kind, started_at, ended_at")
    .gte("started_at", fromDayStart.toISOString())
    .lt("started_at", toDayEnd.toISOString());
  if (parsed.data.tutorId != null) {
    query = query.eq("tutor_id", parsed.data.tutorId);
  }
  const { data: rows, error } = await query;
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  type WorkRow = {
    tutor_id: number;
    kind: "active" | "playback" | "recording";
    started_at: Date;
    ended_at: Date;
  };

  const byTutorDay = new Map<string, WorkRow[]>();
  for (const r of rows ?? []) {
    const started = new Date(r.started_at);
    const day = localDateInTz(started, tz);
    const key = `${r.tutor_id}:${day}`;
    const bucket = byTutorDay.get(key) ?? [];
    bucket.push({
      tutor_id: r.tutor_id,
      kind: r.kind as "active" | "playback" | "recording",
      started_at: started,
      ended_at: new Date(r.ended_at),
    });
    byTutorDay.set(key, bucket);
  }

  const days: string[] = [];
  {
    let cursor = parseISO(parsed.data.from);
    const last = parseISO(parsed.data.to);
    while (cursor <= last) {
      days.push(format(cursor, "yyyy-MM-dd"));
      cursor = addDays(cursor, 1);
    }
  }

  let tutorIds: number[];
  if (parsed.data.tutorId != null) {
    tutorIds = [parsed.data.tutorId];
  } else {
    tutorIds = Array.from(new Set((rows ?? []).map((r) => r.tutor_id)));
  }

  const { data: tutorRows } = await sb
    .from("users")
    .select("id, name, preferred_name, avatar_file_id")
    .in("id", tutorIds);
  const tutorMeta = new Map(
    (tutorRows ?? []).map((u) => [
      u.id,
      {
        tutor_name: u.preferred_name ?? u.name ?? `ID ${u.id}`,
        tutor_has_avatar: !!u.avatar_file_id,
      },
    ]),
  );

  const tutors: TutorRollup[] = tutorIds.map((tutor_id) => {
    const meta = tutorMeta.get(tutor_id) ?? {
      tutor_name: `ID ${tutor_id}`,
      tutor_has_avatar: false,
    };
    const dayBuckets: DayBucket[] = days.map((date) => {
      const events = byTutorDay.get(`${tutor_id}:${date}`) ?? [];
      const raw = computeWorkBuckets(events);
      const capped = applyDailyCap(raw, DAILY_CAP_SEC);
      return { date, ...capped };
    });
    const totals: WorkBuckets = dayBuckets.reduce(
      (acc, d) => ({
        recording_s: acc.recording_s + d.recording_s,
        playback_s: acc.playback_s + d.playback_s,
        active_s: acc.active_s + d.active_s,
        total_s: acc.total_s + d.total_s,
      }),
      { recording_s: 0, playback_s: 0, active_s: 0, total_s: 0 },
    );
    return { tutor_id, ...meta, days: dayBuckets, totals };
  });

  tutors.sort((a, b) => b.totals.total_s - a.totals.total_s);

  return Response.json(
    {
      range: { from: parsed.data.from, to: parsed.data.to, days: days.length },
      tutors,
    },
    { headers: noStoreHeaders },
  );
}
```

- [ ] **Step 2: Verify `date-fns-tz` is installed**

```bash
grep '"date-fns-tz"' package.json
```

Expected: a version is listed. If not, add it:

```bash
pnpm add date-fns-tz
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/tutor-work/route.ts package.json pnpm-lock.yaml
git commit -m "feat(tutor-work): admin GET endpoint with per-day buckets

Range-filtered query over tutor_work_events, grouped by (tutor, admin-tz
day), merged via computeWorkBuckets, daily-cap clamped at 16h. Sorted by
period total descending. Optional tutorId filter.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: i18n + AdminTutorWorkPanel + admin/page.tsx mount

**Files:**
- Modify: `src/lib/i18n/admin.ts`
- Create: `src/components/AdminTutorWorkPanel.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Add i18n group**

In `src/lib/i18n/admin.ts`, after the existing `connections` group, add:

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
  loadError: "Не удалось загрузить",
};
```

Register `tutorWork,` in the `export const admin = { ... }` block at the bottom of the file.

- [ ] **Step 2: Create the component**

Create `src/components/AdminTutorWorkPanel.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import { addDays, format, parseISO, startOfWeek, startOfMonth } from "date-fns";

interface DayBucket {
  date: string;
  recording_s: number;
  playback_s: number;
  active_s: number;
  total_s: number;
}

interface TutorRollup {
  tutor_id: number;
  tutor_name: string;
  tutor_has_avatar: boolean;
  days: DayBucket[];
  totals: { recording_s: number; playback_s: number; active_s: number; total_s: number };
}

interface ApiResponse {
  range: { from: string; to: string; days: number };
  tutors: TutorRollup[];
}

type Preset = "today" | "week" | "month" | "custom";

function fmtDuration(s: number): string {
  if (s <= 0) return "0м";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}м`;
}

export function AdminTutorWorkPanel({ jwt }: { jwt: string }) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    if (preset === "today") {
      setFrom(today);
      setTo(today);
    } else if (preset === "week") {
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      setFrom(format(weekStart, "yyyy-MM-dd"));
      setTo(today);
    } else if (preset === "month") {
      setFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setTo(today);
    }
  }, [preset, today]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/tutor-work?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${jwt}` },
        },
      );
      if (!r.ok) {
        setError(ru.admin.tutorWork.loadError);
        setData(null);
        return;
      }
      setData((await r.json()) as ApiResponse);
    } catch {
      setError(ru.admin.tutorWork.loadError);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [from, to, jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {ru.admin.tutorWork.sectionTitle}
        </h2>
      </header>

      <div className="inline-flex rounded-full bg-tg-bg-secondary p-0.5 text-xs font-medium mb-3">
        {(["today", "week", "month", "custom"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            className={`px-3 h-8 rounded-full transition-colors ${
              preset === p ? "bg-tg-bg-section text-tg-text shadow-sm" : "text-tg-text-hint"
            }`}
          >
            {p === "today"
              ? ru.admin.tutorWork.rangeTodayBtn
              : p === "week"
                ? ru.admin.tutorWork.rangeWeekBtn
                : p === "month"
                  ? ru.admin.tutorWork.rangeMonthBtn
                  : "…"}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2 mb-3 text-xs text-tg-text-hint">
          <span>{ru.admin.tutorWork.customRangeFrom}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
          <span>{ru.admin.tutorWork.customRangeTo}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium mb-3">
          {error}
        </div>
      )}

      {busy && !data && (
        <div className="text-center py-6">
          <Spinner />
        </div>
      )}

      {data && data.tutors.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {ru.admin.tutorWork.noActivity}
        </div>
      )}

      {data && data.tutors.length > 0 && (
        <ul className="space-y-2">
          {data.tutors.map((t) => {
            const todayBucket = t.days.find((d) => d.date === today);
            const todayTotal = todayBucket?.total_s ?? 0;
            return (
              <li
                key={t.tutor_id}
                className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
              >
                <Avatar
                  size={48}
                  name={t.tutor_name}
                  imageUrl={
                    t.tutor_has_avatar
                      ? `/api/avatar/${t.tutor_id}?token=${encodeURIComponent(jwt)}`
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium tracking-tight truncate">
                      {t.tutor_name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-tg-text-hint">
                      {ru.admin.tutorWork.periodTotalLabel}{" "}
                      <span className="text-tg-text font-medium">
                        {fmtDuration(t.totals.total_s)}
                      </span>
                    </span>
                  </div>
                  <div className="text-[11px] text-tg-text-hint tabular-nums mt-0.5">
                    ⏱ {ru.admin.tutorWork.bucketActiveLabel} {fmtDuration(t.totals.active_s)}
                    {" · "}▶ {ru.admin.tutorWork.bucketPlaybackLabel}{" "}
                    {fmtDuration(t.totals.playback_s)}
                    {" · "}🎙 {ru.admin.tutorWork.bucketRecordingLabel}{" "}
                    {fmtDuration(t.totals.recording_s)}
                  </div>
                  <div className="text-[11px] text-tg-text-hint mt-0.5">
                    {ru.admin.tutorWork.todayTotalLabel}{" "}
                    <span className="text-tg-text tabular-nums">
                      {fmtDuration(todayTotal)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Mount in admin/page.tsx**

In `src/app/admin/page.tsx`, find the existing CollapsibleSection chain. Add the import:

```tsx
import { AdminTutorWorkPanel } from "@/components/AdminTutorWorkPanel";
```

Add a new CollapsibleSection (default-closed) after the existing sections:

```tsx
        <CollapsibleSection id="tutor-work" title={ru.admin.tutorWork.sectionTitle}>
          <AdminTutorWorkPanel jwt={jwt} />
        </CollapsibleSection>
```

- [ ] **Step 4: Typecheck + run tests**

```bash
pnpm typecheck && pnpm test
```

Expected: clean typecheck, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/admin.ts src/components/AdminTutorWorkPanel.tsx src/app/admin/page.tsx
git commit -m "feat(tutor-work): admin panel — per-tutor totals with bucket breakdown

Range presets (today / week / month / custom), per-tutor card showing
period total + active/playback/recording breakdown + today's total.
Sorted by period total descending. Mounted as a default-closed
CollapsibleSection in the admin page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Final verification + push

- [ ] **Step 1: Run full test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: clean typecheck + all tests pass.

- [ ] **Step 2: Smoke matrix**

Spin up the dev server and walk through:

| Scenario | Expected |
|---|---|
| Open Mini App as teacher, sit on inbox 90s | `tutor_work_events` rows accumulate, kind='active' |
| Send a 30s voice reply | one `recording` row, started_at = now-30s, ended_at = now |
| Play a student's 45s voice fully twice | two `playback` rows, each with ref_id = student.id |
| `curl` POST /api/tutor-work/playback with no active overlap | rejected silently, no row, server logs `no-active-overlap` |
| Leave Mini App focused but idle 10 min | heartbeats stop after 2 min |
| Switch to another TG chat | `deactivated` fires, flush heartbeat sent, no more pings |
| Open `/admin`, expand "Рабочее время тренеров", pick "Сегодня" | tutors with today's events show with correct totals |
| Pick "Этот месяц" | totals aggregate across the month |
| Pick "custom" + a date range | from/to inputs work, data loads correctly |

If any step misbehaves, diagnose before pushing.

- [ ] **Step 3: Push**

```bash
git push
```

Expected: 11 commits land on `origin/main`.
