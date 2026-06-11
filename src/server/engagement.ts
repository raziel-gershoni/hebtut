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
export function evaluateSlump(
  currentWeekS: number,
  priorWeekS: number,
  isOpen: boolean,
  inactiveIsOpen: boolean,
): boolean {
  // Spec: slump is only evaluated while the student is still active —
  // once silent, the inactive flag owns the situation.
  if (inactiveIsOpen) return false;
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
  if (isOpen) return median7 < Math.max(PLATEAU_SHALLOW_SECONDS, PLATEAU_RESOLVE_RATIO * median30);
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
