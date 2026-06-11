# Engagement Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily rule-based engagement monitoring — five flag kinds (inactive/slump/plateau/ghosting/tutor_sla) on trial+active students, with journal events, an admin panel, and a daily admin digest DM.

**Architecture:** A `student_flags` table (one row per student+concern, updated in place), a pure decision core in `src/server/engagement.ts` (unit-tested), and a daily QStash cron `/api/cron/engagement` that evaluates signals from `quota_usage`/`messages`, applies open/escalate/resolve transitions, journals them, and fans out a digest DM to admins. Read-only «Активность» panel on /admin. Spec: `docs/superpowers/specs/2026-06-11-engagement-monitoring-design.md`.

**Tech Stack:** Next.js 14 route handlers + client components, Supabase, QStash crons, date-fns(-tz), zod not needed (no request bodies), vitest, `ru.*` i18n.

**Binding conventions:**
- All user-visible Russian strings in `src/lib/i18n/` (CLAUDE.md).
- Day-math per student tz via existing `localDateInTz` (see `src/server/quota.ts` imports — it lives in `src/lib/time.ts` or similar; reuse the same import the quota module uses).
- After each task: `npx tsc --noEmit` clean, `npx vitest run` green, `npx eslint <touched files>` clean.
- Cron auth: `Bearer ${serverEnv.CRON_SECRET}`, export GET+POST (match `src/app/api/cron/subscriptions/route.ts`).

---

### Task 1: Migration + DB types

**Files:**
- Create: `supabase/migrations/20260611000001_student_flags.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Migration**

```sql
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
```

- [ ] **Step 2: DB types**

In `src/types/database.ts`, add next to the other table types (follow the exact Row/Insert/Update shape of `onboarding_timers` at ~line 434):

```ts
export type StudentFlagKind =
  | "inactive"
  | "slump"
  | "plateau"
  | "ghosting"
  | "tutor_sla";
export type StudentFlagTier = "sliding" | "at_risk" | "dormant";

export interface StudentFlagRow {
  student_id: number;
  kind: StudentFlagKind;
  tier: StudentFlagTier | null;
  opened_at: string;
  last_evaluated_at: string;
  resolved_at: string | null;
  meta: Json;
}
```

and register `student_flags` in `Database["public"]["Tables"]` with Row = `StudentFlagRow`, Insert = all fields optional except `student_id`,`kind`, Update = all optional (mirror how `onboarding_timers` is registered).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass.

```bash
git add supabase/migrations/20260611000001_student_flags.sql src/types/database.ts
git commit -m "feat(engagement): student_flags table + types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure decision core (TDD)

**Files:**
- Create: `src/server/engagement.ts`
- Modify: `src/server/streak.ts` (export the threshold)
- Test: `tests/engagement.test.ts`

- [ ] **Step 1: Export the practice threshold**

In `src/server/streak.ts`, change `const PRACTICE_THRESHOLD_SECONDS = 30;` (line ~5) to `export const PRACTICE_THRESHOLD_SECONDS = 30;`.

- [ ] **Step 2: Write the failing tests**

Create `tests/engagement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyInactivity,
  evaluateSlump,
  evaluatePlateau,
  median,
  computePracticeSignals,
  diffFlagStates,
  type ExistingFlag,
  type DesiredFlag,
} from "@/server/engagement";

describe("classifyInactivity", () => {
  it("maps day boundaries to tiers", () => {
    expect(classifyInactivity(0)).toBeNull();
    expect(classifyInactivity(1)).toBeNull();
    expect(classifyInactivity(2)).toBe("sliding");
    expect(classifyInactivity(6)).toBe("sliding");
    expect(classifyInactivity(7)).toBe("at_risk");
    expect(classifyInactivity(29)).toBe("at_risk");
    expect(classifyInactivity(30)).toBe("dormant");
    expect(classifyInactivity(365)).toBe("dormant");
  });
});

describe("evaluateSlump", () => {
  it("opens when current week < 50% of a substantial prior week", () => {
    expect(evaluateSlump(200, 600, false)).toBe(true);
  });
  it("does not open below the prior-week floor", () => {
    expect(evaluateSlump(100, 400, false)).toBe(false); // prior < 600s
  });
  it("does not open at exactly the ratio boundary", () => {
    expect(evaluateSlump(300, 600, false)).toBe(false); // not < 50%
  });
  it("holds open inside the hysteresis band", () => {
    expect(evaluateSlump(400, 600, true)).toBe(true); // 66% < 75% resolve bar
  });
  it("resolves above the hysteresis bar", () => {
    expect(evaluateSlump(450, 600, true)).toBe(false); // 75% reached
  });
  it("resolves an open flag when prior week is zero", () => {
    expect(evaluateSlump(0, 0, true)).toBe(false);
  });
});

describe("evaluatePlateau", () => {
  it("opens on a long streak of shallow days (absolute bar)", () => {
    expect(evaluatePlateau(10, 45, 60, false)).toBe(true); // < 90s
  });
  it("opens relative to own norm", () => {
    expect(evaluatePlateau(10, 100, 300, false)).toBe(true); // < 50% of 300
  });
  it("does not open without the streak", () => {
    expect(evaluatePlateau(6, 40, 200, false)).toBe(false);
  });
  it("does not open when practicing near own norm above the absolute bar", () => {
    expect(evaluatePlateau(10, 120, 130, false)).toBe(false);
  });
  it("holds open in the hysteresis band, resolves at 70% of norm", () => {
    expect(evaluatePlateau(10, 180, 300, true)).toBe(true); // 60% < 70%
    expect(evaluatePlateau(10, 210, 300, true)).toBe(false); // 70% reached
  });
  it("resolves when the streak breaks", () => {
    expect(evaluatePlateau(3, 40, 200, true)).toBe(false);
  });
});

describe("median", () => {
  it("handles empty, odd, even", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3, 9])).toBe(3);
    expect(median([1, 3, 5, 9])).toBe(4);
  });
});

describe("computePracticeSignals", () => {
  // Helper to build a seconds-by-date map: entries are [daysAgo, seconds].
  const today = "2026-06-11";
  function days(entries: [number, number][]): Map<string, number> {
    const m = new Map<string, number>();
    for (const [ago, s] of entries) {
      const d = new Date(Date.UTC(2026, 5, 11));
      d.setUTCDate(d.getUTCDate() - ago);
      m.set(d.toISOString().slice(0, 10), s);
    }
    return m;
  }

  it("computes daysSinceAnchor from the last practiced day", () => {
    const s = computePracticeSignals(days([[3, 120]]), today, null);
    expect(s.daysSinceAnchor).toBe(3);
  });

  it("ignores sub-threshold days for the anchor", () => {
    const s = computePracticeSignals(days([[1, 10], [4, 120]]), today, null);
    expect(s.daysSinceAnchor).toBe(4);
  });

  it("falls back to the provided anchor when never practiced", () => {
    const s = computePracticeSignals(days([]), today, "2026-06-08");
    expect(s.daysSinceAnchor).toBe(3);
  });

  it("returns null daysSinceAnchor with no practice and no fallback", () => {
    const s = computePracticeSignals(days([]), today, null);
    expect(s.daysSinceAnchor).toBeNull();
  });

  it("sums current (d0..d6) and prior (d7..d13) week seconds", () => {
    const s = computePracticeSignals(days([[1, 100], [6, 50], [7, 200], [13, 40]]), today, null);
    expect(s.currentWeekS).toBe(150);
    expect(s.priorWeekS).toBe(240);
  });

  it("computes streak (today optional) and medians over practiced days", () => {
    const s = computePracticeSignals(
      days([[1, 60], [2, 60], [3, 90], [4, 120], [5, 60], [6, 60], [7, 60]]),
      today,
      null,
    );
    expect(s.streak).toBe(7);
    expect(s.median7).toBe(60);
    expect(s.median30).toBe(60);
  });
});

describe("diffFlagStates", () => {
  const open = (kind: string, tier: string | null = null): ExistingFlag =>
    ({ kind, tier } as ExistingFlag);
  const want = (kind: string, tier: string | null = null): DesiredFlag =>
    ({ kind, tier, meta: {} } as DesiredFlag);

  it("opens new, resolves gone, ignores unchanged", () => {
    const t = diffFlagStates([open("slump")], [want("ghosting")]);
    expect(t).toEqual([
      { type: "open", kind: "ghosting", tier: null, meta: {} },
      { type: "resolve", kind: "slump" },
    ]);
  });

  it("escalates on inactive tier change", () => {
    const t = diffFlagStates([open("inactive", "sliding")], [want("inactive", "at_risk")]);
    expect(t).toEqual([{ type: "escalate", kind: "inactive", tier: "at_risk", meta: {} }]);
  });

  it("emits nothing when state matches", () => {
    expect(diffFlagStates([open("inactive", "sliding")], [want("inactive", "sliding")])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/engagement.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/server/engagement.ts`**

```ts
import { PRACTICE_THRESHOLD_SECONDS } from "@/server/streak";

/**
 * Engagement-monitoring decision core. Pure functions only — the cron
 * (src/app/api/cron/engagement) gathers the data and applies the
 * transitions; everything here is unit-testable without Supabase.
 *
 * Thresholds are deliberately hand-set constants (research consensus at
 * this user count: transparent rules beat learned models). Tune here;
 * promoting to app_settings is an explicit v2 item in the spec.
 */
export const INACTIVE_SLIDING_DAYS = 2;
export const INACTIVE_AT_RISK_DAYS = 7;
export const INACTIVE_DORMANT_DAYS = 30;
export const SLUMP_RATIO = 0.5;
export const SLUMP_RESOLVE_RATIO = 0.75;
export const SLUMP_MIN_PRIOR_SECONDS = 600;
export const PLATEAU_MIN_STREAK = 7;
export const PLATEAU_SHALLOW_SECONDS = 90;
export const PLATEAU_RELATIVE = 0.5;
export const PLATEAU_RESOLVE_RATIO = 0.7;
export const GHOSTING_HOURS = 72;
export const TUTOR_SLA_HOURS = 24;
/** How far back we look at messages for ghosting; older silence is the
 * inactive flag's story anyway. */
export const GHOSTING_LOOKBACK_DAYS = 14;
/** quota_usage window loaded per sweep: 30d median + 7d current week. */
export const SIGNAL_WINDOW_DAYS = 37;

export type FlagKind = "inactive" | "slump" | "plateau" | "ghosting" | "tutor_sla";
export type InactiveTier = "sliding" | "at_risk" | "dormant";

export interface ExistingFlag {
  kind: FlagKind;
  tier: string | null;
}
export interface DesiredFlag {
  kind: FlagKind;
  tier: InactiveTier | null;
  meta: Record<string, unknown>;
}
export type Transition =
  | { type: "open"; kind: FlagKind; tier: InactiveTier | null; meta: Record<string, unknown> }
  | { type: "escalate"; kind: FlagKind; tier: InactiveTier | null; meta: Record<string, unknown> }
  | { type: "resolve"; kind: FlagKind; reason?: string };

export function classifyInactivity(daysSinceAnchor: number): InactiveTier | null {
  if (daysSinceAnchor >= INACTIVE_DORMANT_DAYS) return "dormant";
  if (daysSinceAnchor >= INACTIVE_AT_RISK_DAYS) return "at_risk";
  if (daysSinceAnchor >= INACTIVE_SLIDING_DAYS) return "sliding";
  return null;
}

/** Desired open-state for the slump flag, with hysteresis. */
export function evaluateSlump(currentWeekS: number, priorWeekS: number, isOpen: boolean): boolean {
  if (isOpen) return currentWeekS < SLUMP_RESOLVE_RATIO * priorWeekS;
  return priorWeekS >= SLUMP_MIN_PRIOR_SECONDS && currentWeekS < SLUMP_RATIO * priorWeekS;
}

/** Desired open-state for the plateau flag, with hysteresis. */
export function evaluatePlateau(
  streak: number,
  median7: number,
  median30: number,
  isOpen: boolean,
): boolean {
  if (streak < PLATEAU_MIN_STREAK) return false;
  if (isOpen) return median7 < PLATEAU_RESOLVE_RATIO * median30;
  return median7 < Math.max(PLATEAU_SHALLOW_SECONDS, PLATEAU_RELATIVE * median30);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface PracticeSignals {
  /** Full days since last practiced day (or fallback anchor). null = no anchor at all. */
  daysSinceAnchor: number | null;
  currentWeekS: number;
  priorWeekS: number;
  streak: number;
  /** Median seconds over the last 7 practiced days (within the window). */
  median7: number;
  /** Median seconds over practiced days in the trailing 30 days. */
  median30: number;
}

/** All local-date strings are YYYY-MM-DD in the student's tz. */
export function computePracticeSignals(
  secondsByLocalDate: Map<string, number>,
  todayLocal: string,
  fallbackAnchorLocalDate: string | null,
): PracticeSignals {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Date.parse(`${todayLocal}T00:00:00Z`);
  const dateAgo = (n: number) => new Date(today - n * dayMs).toISOString().slice(0, 10);

  const practiced = (d: string) => (secondsByLocalDate.get(d) ?? 0) >= PRACTICE_THRESHOLD_SECONDS;

  // Anchor: most recent practiced day in the window.
  let daysSinceAnchor: number | null = null;
  for (let n = 0; n <= SIGNAL_WINDOW_DAYS; n++) {
    if (practiced(dateAgo(n))) {
      daysSinceAnchor = n;
      break;
    }
  }
  if (daysSinceAnchor == null && fallbackAnchorLocalDate) {
    daysSinceAnchor = Math.max(
      0,
      Math.round((today - Date.parse(`${fallbackAnchorLocalDate}T00:00:00Z`)) / dayMs),
    );
  }

  let currentWeekS = 0;
  let priorWeekS = 0;
  for (let n = 0; n <= 6; n++) currentWeekS += secondsByLocalDate.get(dateAgo(n)) ?? 0;
  for (let n = 7; n <= 13; n++) priorWeekS += secondsByLocalDate.get(dateAgo(n)) ?? 0;

  // Streak: walk back from yesterday; today counts if practiced but a
  // not-yet-practiced today doesn't break it (mirrors computeStreak).
  let streak = practiced(todayLocal) ? 1 : 0;
  for (let n = 1; n <= SIGNAL_WINDOW_DAYS; n++) {
    if (practiced(dateAgo(n))) streak++;
    else break;
  }

  const practicedSeconds30: number[] = [];
  for (let n = 0; n <= 29; n++) {
    const s = secondsByLocalDate.get(dateAgo(n)) ?? 0;
    if (s >= PRACTICE_THRESHOLD_SECONDS) practicedSeconds30.push(s);
  }
  const median30 = median(practicedSeconds30);
  const median7 = median(practicedSeconds30.slice(0, 7));

  return { daysSinceAnchor, currentWeekS, priorWeekS, streak, median7, median30 };
}

export function diffFlagStates(existing: ExistingFlag[], desired: DesiredFlag[]): Transition[] {
  const out: Transition[] = [];
  const desiredByKind = new Map(desired.map((d) => [d.kind, d]));
  const existingByKind = new Map(existing.map((e) => [e.kind, e]));
  for (const d of desired) {
    const e = existingByKind.get(d.kind);
    if (!e) out.push({ type: "open", kind: d.kind, tier: d.tier, meta: d.meta });
    else if ((e.tier ?? null) !== (d.tier ?? null))
      out.push({ type: "escalate", kind: d.kind, tier: d.tier, meta: d.meta });
  }
  for (const e of existing) {
    if (!desiredByKind.has(e.kind)) out.push({ type: "resolve", kind: e.kind });
  }
  return out;
}
```

NOTE on `computePracticeSignals` date math: it intentionally does UTC
arithmetic on local-date STRINGS — the strings were already produced in
the student's tz by `localDateInTz`, so treating them as UTC dates is a
pure calendar computation, the same trick the quota tests use.

- [ ] **Step 5: Tests green + full suite + commit**

Run: `npx vitest run tests/engagement.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx vitest run` → all pass.

```bash
git add src/server/engagement.ts src/server/streak.ts tests/engagement.test.ts
git commit -m "feat(engagement): pure decision core — tiers, slump/plateau hysteresis, diff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: i18n strings

**Files:**
- Modify: `src/lib/i18n/admin.ts`
- Modify: `src/lib/i18n/bot.ts`

- [ ] **Step 1: Admin strings**

In `src/lib/i18n/admin.ts`, add a new top-level group (before `const users = {`):

```ts
const engagement = {
  emptyState: "Все занимаются 🎉",
  groupNeedsAttention: "Требуют внимания",
  groupSliding: "Скользят",
  groupPlateau: "Плато",
  sinceDate: (date: string) => `с ${date}`,
  metricInactive: (days: number) =>
    `молчит ${days} ${pluralDay(days)}`,
  metricSlump: (pct: number) => `минус ${pct}% за неделю`,
  metricPlateau: (streak: number, medianS: number) =>
    `серия ${streak} ${pluralDay(streak)}, по ~${medianS}с в день`,
  metricGhosting: (hours: number) => `тренер ждёт ответа ${Math.round(hours / 24)} ${pluralDay(Math.round(hours / 24))}`,
  metricTutorSla: (hours: number) => `ответ тренера висит ${hours} ч`,
  loadError: "Не удалось загрузить",
};
```

`pluralDay` is already exported from the i18n package root (`src/lib/i18n/index.ts` re-exports it per CLAUDE.md) — import it at the top of admin.ts the way other modules do (check how `student.ts` or `common.ts` does it; if admin.ts doesn't import it yet, add `import { pluralDay } from "./common";`).

Register `engagement,` in `export const admin = { … }` after `admins,`. Add a section title in `pages.sections` after `users`/`admins`: `engagement: "Активность",`.

In the `audit` group's `actions` map add:

```ts
    "engagement.flag_open": "Флаг активности",
    "engagement.flag_escalate": "Эскалация флага",
    "engagement.flag_resolve": "Флаг снят",
    "engagement.digest_sent": "Дайджест активности",
```

- [ ] **Step 2: Bot digest strings**

In `src/lib/i18n/bot.ts`, add a group (before `const transcripts`):

```ts
// Daily engagement digest DM'd to admins by /api/cron/engagement.
const engagementDigest = {
  header: (newCount: number, total: number) =>
    `📊 Активность: ${newCount} новых, ${total} всего`,
  headerNoNew: (total: number) => `📊 Активность: ${total} на контроле`,
  newPrefix: "🆕 ",
  ongoingPrefix: "Всё ещё: ",
  openPanelButton: "Открыть панель",
};
```

Register `engagementDigest,` in `export const bot = { … }`.

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green.

```bash
git add src/lib/i18n/admin.ts src/lib/i18n/bot.ts
git commit -m "feat(i18n): engagement panel, journal, and digest strings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Cron route + QStash registry

**Files:**
- Create: `src/app/api/cron/engagement/route.ts`
- Modify: `scripts/sync-qstash.mjs`

- [ ] **Step 1: The cron route**

Create `src/app/api/cron/engagement/route.ts`. Follow the auth/shape of `src/app/api/cron/subscriptions/route.ts`. Full implementation:

```ts
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";
import { localDateInTz } from "@/lib/time";
import {
  GHOSTING_HOURS,
  GHOSTING_LOOKBACK_DAYS,
  SIGNAL_WINDOW_DAYS,
  TUTOR_SLA_HOURS,
  classifyInactivity,
  computePracticeSignals,
  diffFlagStates,
  evaluatePlateau,
  evaluateSlump,
  type DesiredFlag,
  type ExistingFlag,
  type Transition,
} from "@/server/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

interface MonitoredStudent {
  id: number;
  tz: string;
  name: string | null;
  preferred_name: string | null;
  anchor_fallback_iso: string; // trial_started_at ?? created_at
}

async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Monitored population: students, not suspended, raw sub status
  // trial/active, trial not yet past its end (the hourly subscriptions
  // cron flips those; we just skip not-yet-flipped rows), not frozen.
  const { data: rows } = await sb
    .from("users")
    .select(
      "id, tz, name, preferred_name, created_at, subscriptions!inner(status, trial_started_at, trial_ends_at, frozen_until)",
    )
    .eq("role", "student")
    .eq("status", "active")
    .in("subscriptions.status", ["trial", "active"]);

  const students: MonitoredStudent[] = (rows ?? [])
    .filter((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      if (!sub) return false;
      if (sub.status === "trial" && sub.trial_ends_at && new Date(sub.trial_ends_at) < now) return false;
      if (sub.frozen_until && new Date(sub.frozen_until) > now) return false;
      return true;
    })
    .map((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      return {
        id: r.id,
        tz: r.tz ?? serverEnv.DEFAULT_TZ,
        name: r.name,
        preferred_name: r.preferred_name,
        anchor_fallback_iso: sub?.trial_started_at ?? r.created_at,
      };
    });
  const monitoredIds = new Set(students.map((s) => s.id));

  // 2. Open flags (for everyone, incl. students who left the population).
  const { data: openFlags } = await sb
    .from("student_flags")
    .select("student_id, kind, tier")
    .is("resolved_at", null);
  const openByStudent = new Map<number, ExistingFlag[]>();
  for (const f of openFlags ?? []) {
    const arr = openByStudent.get(f.student_id) ?? [];
    arr.push({ kind: f.kind, tier: f.tier });
    openByStudent.set(f.student_id, arr);
  }

  // 3. Batched signal reads.
  const ids = students.map((s) => s.id);
  const windowStartIso = new Date(now.getTime() - (SIGNAL_WINDOW_DAYS + 2) * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data: usage } = ids.length
    ? await sb
        .from("quota_usage")
        .select("student_id, date, seconds_used")
        .in("student_id", ids)
        .gte("date", windowStartIso)
    : { data: [] as { student_id: number; date: string; seconds_used: number }[] };
  const usageByStudent = new Map<number, Map<string, number>>();
  for (const u of usage ?? []) {
    const m = usageByStudent.get(u.student_id) ?? new Map<string, number>();
    m.set(u.date, u.seconds_used);
    usageByStudent.set(u.student_id, m);
  }

  // Latest in/out per student over the ghosting lookback.
  const msgsSinceIso = new Date(now.getTime() - GHOSTING_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data: recentMsgs } = ids.length
    ? await sb
        .from("messages")
        .select("student_id, direction, created_at")
        .in("student_id", ids)
        .gte("created_at", msgsSinceIso)
    : { data: [] as { student_id: number; direction: string; created_at: string }[] };
  const latestIn = new Map<number, number>();
  const latestOut = new Map<number, number>();
  for (const m of recentMsgs ?? []) {
    const t = new Date(m.created_at).getTime();
    const map = m.direction === "in" ? latestIn : latestOut;
    if ((map.get(m.student_id) ?? 0) < t) map.set(m.student_id, t);
  }

  // Oldest pending inbound per student (tutor SLA).
  const slaCutoffIso = new Date(now.getTime() - TUTOR_SLA_HOURS * 3600_000).toISOString();
  const { data: pendingRows } = ids.length
    ? await sb
        .from("messages")
        .select("student_id, id, created_at")
        .in("student_id", ids)
        .eq("direction", "in")
        .eq("status", "pending")
        .lt("created_at", slaCutoffIso)
    : { data: [] as { student_id: number; id: number; created_at: string }[] };
  const oldestPending = new Map<number, { id: number; created_at: string }>();
  for (const p of pendingRows ?? []) {
    const cur = oldestPending.get(p.student_id);
    if (!cur || p.created_at < cur.created_at) {
      oldestPending.set(p.student_id, { id: p.id, created_at: p.created_at });
    }
  }

  // 4. Evaluate + diff per student.
  let opened = 0;
  let escalated = 0;
  let resolved = 0;
  const newFlagLines: string[] = [];

  async function applyTransition(studentId: number, t: Transition): Promise<void> {
    if (t.type === "resolve") {
      await sb
        .from("student_flags")
        .update({ resolved_at: nowIso, last_evaluated_at: nowIso })
        .eq("student_id", studentId)
        .eq("kind", t.kind)
        .is("resolved_at", null);
      resolved++;
      await recordAudit({
        action: "engagement.flag_resolve",
        actorId: null,
        subjectType: "user",
        subjectId: studentId,
        meta: { kind: t.kind, ...(t.reason ? { reason: t.reason } : {}) },
      });
      return;
    }
    await sb.from("student_flags").upsert(
      {
        student_id: studentId,
        kind: t.kind,
        tier: t.tier,
        opened_at: t.type === "open" ? nowIso : undefined,
        last_evaluated_at: nowIso,
        resolved_at: null,
        meta: t.meta,
      },
      { onConflict: "student_id,kind" },
    );
    if (t.type === "open") opened++;
    else escalated++;
    await recordAudit({
      action: t.type === "open" ? "engagement.flag_open" : "engagement.flag_escalate",
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { kind: t.kind, tier: t.tier, ...t.meta },
    });
  }

  for (const s of students) {
    try {
      const todayLocal = localDateInTz(now, s.tz);
      const fallbackAnchorLocal = localDateInTz(new Date(s.anchor_fallback_iso), s.tz);
      const signals = computePracticeSignals(
        usageByStudent.get(s.id) ?? new Map(),
        todayLocal,
        fallbackAnchorLocal,
      );
      const existing = openByStudent.get(s.id) ?? [];
      const has = (k: string) => existing.some((e) => e.kind === k);

      const desired: DesiredFlag[] = [];

      const tier =
        signals.daysSinceAnchor != null ? classifyInactivity(signals.daysSinceAnchor) : null;
      if (tier) {
        desired.push({
          kind: "inactive",
          tier,
          meta: { days_silent: signals.daysSinceAnchor },
        });
      }

      // Slump only while not inactive (once silent, inactive owns it).
      if (!tier && evaluateSlump(signals.currentWeekS, signals.priorWeekS, has("slump"))) {
        desired.push({
          kind: "slump",
          tier: null,
          meta: { current_week_s: signals.currentWeekS, prior_week_s: signals.priorWeekS },
        });
      }

      if (evaluatePlateau(signals.streak, signals.median7, signals.median30, has("plateau"))) {
        desired.push({
          kind: "plateau",
          tier: null,
          meta: { streak: signals.streak, median7_s: signals.median7, median30_s: signals.median30 },
        });
      }

      const inT = latestIn.get(s.id) ?? 0;
      const outT = latestOut.get(s.id) ?? 0;
      if (outT > inT && now.getTime() - outT >= GHOSTING_HOURS * 3600_000) {
        desired.push({
          kind: "ghosting",
          tier: null,
          meta: { gap_hours: Math.round((now.getTime() - outT) / 3600_000) },
        });
      }

      const pending = oldestPending.get(s.id);
      if (pending) {
        desired.push({
          kind: "tutor_sla",
          tier: null,
          meta: {
            pending_message_id: pending.id,
            pending_hours: Math.round(
              (now.getTime() - new Date(pending.created_at).getTime()) / 3600_000,
            ),
          },
        });
      }

      const transitions = diffFlagStates(existing, desired);
      for (const t of transitions) {
        await applyTransition(s.id, t);
        if (t.type === "open" || t.type === "escalate") {
          const name = s.preferred_name ?? s.name ?? `#${s.id}`;
          newFlagLines.push(`${ru.bot.engagementDigest.newPrefix}${name} — ${metricLine(t)}`);
        }
      }
      // Touch last_evaluated_at + refresh meta on unchanged open flags.
      for (const d of desired) {
        if (transitions.every((t) => t.kind !== d.kind)) {
          await sb
            .from("student_flags")
            .update({ last_evaluated_at: nowIso, meta: d.meta })
            .eq("student_id", s.id)
            .eq("kind", d.kind)
            .is("resolved_at", null);
        }
      }
    } catch (e) {
      console.warn("[engagement] student sweep failed", {
        student_id: s.id,
        reason: (e as Error).message,
      });
    }
  }

  // 5. Resolve flags of students who left the population.
  for (const [studentId, flags] of openByStudent) {
    if (monitoredIds.has(studentId)) continue;
    for (const f of flags) {
      await applyTransition(studentId, { type: "resolve", kind: f.kind, reason: "excluded" });
    }
  }

  // 6. Digest DM to admins (only when something is open).
  const { data: stillOpen } = await sb
    .from("student_flags")
    .select("student_id, kind, tier, meta, users!inner(name, preferred_name)")
    .is("resolved_at", null);
  let digested = 0;
  if (stillOpen?.length) {
    const text = buildDigestText(newFlagLines, stillOpen);
    const { data: admins } = await sb
      .from("users")
      .select("id, tg_chat_id")
      .eq("is_admin", true);
    const base = serverEnv.APP_BASE_URL.replace(/\/$/, "");
    for (const a of admins ?? []) {
      try {
        await getBot().api.sendMessage(a.tg_chat_id, text, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ru.bot.engagementDigest.openPanelButton,
                  web_app: { url: `${base}/admin` },
                },
              ],
            ],
          },
        });
        digested++;
      } catch (e) {
        console.warn("[engagement] digest DM failed", {
          admin_id: a.id,
          reason: (e as Error).message,
        });
      }
    }
    await recordAudit({
      action: "engagement.digest_sent",
      actorId: null,
      meta: { open_flags: stillOpen.length, new_lines: newFlagLines.length, admins_sent: digested },
    });
  }

  return Response.json({ students: students.length, opened, escalated, resolved, digested });
}

function metricLine(t: { kind: string; tier?: string | null; meta: Record<string, unknown> }): string {
  switch (t.kind) {
    case "inactive":
      return ru.admin.engagement.metricInactive(Number(t.meta.days_silent ?? 0));
    case "slump": {
      const cur = Number(t.meta.current_week_s ?? 0);
      const prior = Number(t.meta.prior_week_s ?? 1);
      return ru.admin.engagement.metricSlump(Math.round((1 - cur / Math.max(1, prior)) * 100));
    }
    case "plateau":
      return ru.admin.engagement.metricPlateau(
        Number(t.meta.streak ?? 0),
        Math.round(Number(t.meta.median7_s ?? 0)),
      );
    case "ghosting":
      return ru.admin.engagement.metricGhosting(Number(t.meta.gap_hours ?? 0));
    case "tutor_sla":
      return ru.admin.engagement.metricTutorSla(Number(t.meta.pending_hours ?? 0));
    default:
      return "";
  }
}

function buildDigestText(
  newLines: string[],
  open: { kind: string; tier: string | null; meta: unknown; users: unknown }[],
): string {
  const ongoing = open.length - newLines.length;
  const header =
    newLines.length > 0
      ? ru.bot.engagementDigest.header(newLines.length, open.length)
      : ru.bot.engagementDigest.headerNoNew(open.length);
  const ongoingNames = open
    .slice(0, 15)
    .map((f) => {
      const u = (Array.isArray(f.users) ? f.users[0] : f.users) as {
        name: string | null;
        preferred_name: string | null;
      } | null;
      return u?.preferred_name ?? u?.name ?? "?";
    });
  const ongoingLine =
    ongoing > 0 ? `${ru.bot.engagementDigest.ongoingPrefix}${[...new Set(ongoingNames)].join(", ")}` : "";
  return [header, "", ...newLines, "", ongoingLine].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export { handler as GET, handler as POST };
```

Implementer notes:
- `localDateInTz` — find its actual home with `grep -rn "export function localDateInTz" src/` (quota.ts imports it; match that import path exactly).
- The `subscriptions!inner(...)` embedded-join syntax matches existing usage; if typing fights, fall back to two queries (subscriptions where status in (…) → ids → users in ids) — equivalent semantics.
- `upsert` with `opened_at: undefined` on escalate: Supabase omits undefined keys, so opened_at is preserved on escalate and set fresh on open. If the typing rejects `undefined`, build the object conditionally.

- [ ] **Step 2: Register the schedule**

In `scripts/sync-qstash.mjs`, add to the `SCHEDULES` array (match the existing entry shape exactly):

```js
  { path: "/api/cron/engagement", cron: "0 6 * * *" }, // daily ~09:00 Israel
```

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green; `npx eslint src/app/api/cron/engagement/route.ts` clean.

```bash
git add src/app/api/cron/engagement/route.ts scripts/sync-qstash.mjs
git commit -m "feat(engagement): daily cron — evaluate flags, journal transitions, admin digest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Admin API

**Files:**
- Create: `src/app/api/admin/engagement/route.ts`

- [ ] **Step 1: GET endpoint**

```ts
import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EngagementSeverity = "red" | "yellow" | "grey";

// NOT exported — Next.js route files may only export handlers/config.
function severityFor(kind: string, tier: string | null): EngagementSeverity {
  if (kind === "tutor_sla" || kind === "ghosting") return "red";
  if (kind === "inactive") return tier === "sliding" ? "yellow" : "red";
  if (kind === "slump") return "yellow";
  return "grey"; // plateau
}

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: flags } = await sb
    .from("student_flags")
    .select(
      "student_id, kind, tier, opened_at, meta, users!inner(name, preferred_name, has:avatar_file_id)",
    )
    .is("resolved_at", null);

  const rows = (flags ?? []).map((f) => {
    const u = (Array.isArray(f.users) ? f.users[0] : f.users) as {
      name: string | null;
      preferred_name: string | null;
      has: string | null;
    } | null;
    return {
      student_id: f.student_id,
      kind: f.kind,
      tier: f.tier,
      opened_at: f.opened_at,
      meta: f.meta,
      severity: severityFor(f.kind, f.tier),
      name: u?.preferred_name ?? u?.name ?? `#${f.student_id}`,
      has_avatar: !!u?.has,
    };
  });
  // Red first, then yellow, then grey; oldest flags first within a group.
  const order = { red: 0, yellow: 1, grey: 2 } as const;
  rows.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.opened_at.localeCompare(b.opened_at),
  );
  return Response.json({ flags: rows }, { headers: noStoreHeaders });
}
```

Implementer note: the `has:avatar_file_id` aliased select must match how
other admin endpoints expose `has_avatar` — check `/api/admin/users`
(`src/app/api/admin/users/route.ts`) and copy ITS avatar-presence
technique verbatim instead if it differs.

- [ ] **Step 2: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green; eslint clean.

```bash
git add src/app/api/admin/engagement/route.ts
git commit -m "feat(engagement): admin API — open flags with severity grouping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Panel component + mount

**Files:**
- Create: `src/components/AdminEngagementPanel.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Component**

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";

interface FlagRow {
  student_id: number;
  kind: "inactive" | "slump" | "plateau" | "ghosting" | "tutor_sla";
  tier: string | null;
  opened_at: string;
  meta: Record<string, unknown>;
  severity: "red" | "yellow" | "grey";
  name: string;
  has_avatar: boolean;
}

const GROUPS: { severity: FlagRow["severity"]; title: string; dot: string }[] = [
  { severity: "red", title: ru.admin.engagement.groupNeedsAttention, dot: "🔴" },
  { severity: "yellow", title: ru.admin.engagement.groupSliding, dot: "🟡" },
  { severity: "grey", title: ru.admin.engagement.groupPlateau, dot: "⚪" },
];

function metricLine(f: FlagRow): string {
  switch (f.kind) {
    case "inactive":
      return ru.admin.engagement.metricInactive(Number(f.meta.days_silent ?? 0));
    case "slump": {
      const cur = Number(f.meta.current_week_s ?? 0);
      const prior = Math.max(1, Number(f.meta.prior_week_s ?? 1));
      return ru.admin.engagement.metricSlump(Math.round((1 - cur / prior) * 100));
    }
    case "plateau":
      return ru.admin.engagement.metricPlateau(
        Number(f.meta.streak ?? 0),
        Math.round(Number(f.meta.median7_s ?? 0)),
      );
    case "ghosting":
      return ru.admin.engagement.metricGhosting(Number(f.meta.gap_hours ?? 0));
    case "tutor_sla":
      return ru.admin.engagement.metricTutorSla(Number(f.meta.pending_hours ?? 0));
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function AdminEngagementPanel({ jwt }: { jwt: string }) {
  const [rows, setRows] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch("/api/admin/engagement", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError(ru.admin.engagement.loadError);
      return;
    }
    const d = (await r.json()) as { flags: FlagRow[] };
    setRows(d.flags);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium">
        {error}
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="text-center py-6">
        <Spinner />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
        {ru.admin.engagement.emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const groupRows = rows.filter((r) => r.severity === g.severity);
        if (groupRows.length === 0) return null;
        return (
          <section key={g.severity}>
            <h3 className="text-sm font-semibold tracking-tight mb-2">
              {g.dot} {g.title} ({groupRows.length})
            </h3>
            <ul className="space-y-2">
              {groupRows.map((f) => (
                <li
                  key={`${f.student_id}:${f.kind}`}
                  className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
                >
                  <Avatar
                    name={f.name}
                    size={36}
                    imageUrl={
                      f.has_avatar
                        ? `/api/avatar/${f.student_id}?token=${encodeURIComponent(jwt)}`
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="font-medium tracking-tight truncate">{f.name}</div>
                    <div className="mt-0.5 text-[11px] text-tg-text-hint truncate">
                      {metricLine(f)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-tg-text-hint tabular-nums">
                    {ru.admin.engagement.sinceDate(fmtDate(f.opened_at))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount on /admin**

In `src/app/admin/page.tsx`: import `AdminEngagementPanel`, then insert as the FIRST `CollapsibleSection` (before `id="users"`):

```tsx
      <CollapsibleSection id="engagement" title={ru.admin.pages.sections.engagement}>
        <AdminEngagementPanel jwt={jwt} />
      </CollapsibleSection>
```

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean; eslint clean on both files; `npx vitest run` green.

```bash
git add src/components/AdminEngagementPanel.tsx src/app/admin/page.tsx
git commit -m "feat(engagement): admin panel — tiered needs-attention queue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Journal registry

**Files:**
- Modify: `src/components/AuditLog.tsx`

- [ ] **Step 1: ACTION_DEFS + metaSummary**

Add to `ACTION_DEFS` (after the message.* rows; reuse `G.messages`-style group — add `engagement: "Активность"` to `ru.admin.audit.groups` in `src/lib/i18n/admin.ts` first and use `G.engagement`):

```ts
  "engagement.flag_open": { label: A["engagement.flag_open"], tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", group: G.engagement },
  "engagement.flag_escalate": { label: A["engagement.flag_escalate"], tone: "bg-rose-500/15 text-rose-700 dark:text-rose-400", group: G.engagement },
  "engagement.flag_resolve": { label: A["engagement.flag_resolve"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.engagement },
  "engagement.digest_sent": { label: A["engagement.digest_sent"], tone: "bg-tg-bg-secondary text-tg-text-hint", group: G.engagement },
```

Add to `metaSummary`:

```ts
  if (action.startsWith("engagement.flag_")) {
    const kind = meta.kind ? String(meta.kind) : "";
    const tier = meta.tier ? `→${meta.tier}` : "";
    const days = typeof meta.days_silent === "number" ? ` · ${meta.days_silent}д` : "";
    const reason = meta.reason ? ` (${meta.reason})` : "";
    return `${kind}${tier}${days}${reason}`;
  }
  if (action === "engagement.digest_sent") {
    return `${meta.open_flags ?? "?"} флагов · ${meta.admins_sent ?? "?"} админам`;
  }
```

- [ ] **Step 2: Verify + commit**

`npx tsc --noEmit` clean; eslint clean; `npx vitest run` green.

```bash
git add src/components/AuditLog.tsx src/lib/i18n/admin.ts
git commit -m "feat(engagement): journal entries — labeled, toned, filterable

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification

1. `npx tsc --noEmit` clean; `npx vitest run` green (new engagement tests included).
2. Apply the migration to the database.
3. Run `node scripts/sync-qstash.mjs` (or however schedules are synced in deploy) so the new cron registers.
4. Manual matrix: curl the cron with `Bearer CRON_SECret` → JSON counts; verify `student_flags` rows match expectations for a few known students; journal shows `engagement.flag_open` entries with readable summaries; admins received the digest DM with the panel button; /admin «Активность» renders groups; a student who practices today disappears from the queue on the next cron run (flag resolves + journal entry).
5. Cold-start sanity: the first digest will list the whole backlog — expected.
