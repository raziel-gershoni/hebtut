import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Database, SubscriptionStatus } from "@/types/database";

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

/**
 * Derived status — what the UI should render and what the access gate should
 * decide, computed from the row + current time. Pure: writebacks (trial→
 * trial_expired, active→lapsed, frozen→active) are the responsibility of
 * `getStatus`, which calls this.
 *
 * The trial/active/renewing_soon/trial_ending split exists because the spec's
 * top-strip text varies on a finer-than-status granularity (e.g. "пробный
 * период • 1 день остался" vs "пробный период заканчивается завтра").
 */
export type DerivedStatus =
  | { kind: "trial"; daysLeft: number; endsAt: Date }
  | { kind: "trial_ending"; daysLeft: 0 | 1; endsAt: Date }
  | { kind: "active"; renewsInDays: number; endsAt: Date }
  | { kind: "renewing_soon"; renewsInDays: 0 | 1 | 2; endsAt: Date }
  | { kind: "trial_expired" }
  | { kind: "lapsed" }
  | { kind: "payment_failed" }
  | { kind: "frozen"; untilDate: Date };

/** True for trial / trial_ending / active / renewing_soon — the states where the bot accepts media. */
export function canSendMedia(d: DerivedStatus): boolean {
  return (
    d.kind === "trial" ||
    d.kind === "trial_ending" ||
    d.kind === "active" ||
    d.kind === "renewing_soon"
  );
}

const LOCKOUT_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * "Should the access gate reply to this locked user, or stay silent?"
 * The first locked-message attempt always replies; subsequent attempts within
 * 24 hours stay silent so we don't spam the chat. After 24h the template
 * becomes available again, so a returning student gets the CTA fresh.
 */
export function shouldReplyToLockedUser(
  lastRepliedAtIso: string | null,
  now: Date,
): boolean {
  if (!lastRepliedAtIso) return true;
  return now.getTime() - new Date(lastRepliedAtIso).getTime() >= LOCKOUT_REPLY_COOLDOWN_MS;
}

const DAY_MS = 86_400_000;
const TRIAL_ENDING_HOURS_TODAY = 18; // < 18h remaining → "заканчивается сегодня"

export function deriveStatus(row: SubscriptionRow, now: Date): DerivedStatus {
  switch (row.status as SubscriptionStatus) {
    case "trial": {
      const ends = new Date(row.trial_ends_at);
      const ms = ends.getTime() - now.getTime();
      if (ms <= 0) return { kind: "trial_expired" };
      const daysLeft = Math.ceil(ms / DAY_MS);
      if (daysLeft <= 1) {
        const hoursLeft = ms / 3_600_000;
        return {
          kind: "trial_ending",
          daysLeft: hoursLeft <= TRIAL_ENDING_HOURS_TODAY ? 0 : 1,
          endsAt: ends,
        };
      }
      return { kind: "trial", daysLeft, endsAt: ends };
    }
    case "active": {
      if (!row.current_period_ends_at) return { kind: "lapsed" };
      const ends = new Date(row.current_period_ends_at);
      const ms = ends.getTime() - now.getTime();
      if (ms <= 0) return { kind: "lapsed" };
      const daysLeft = Math.ceil(ms / DAY_MS);
      if (daysLeft <= 2) {
        return {
          kind: "renewing_soon",
          renewsInDays: Math.max(0, daysLeft) as 0 | 1 | 2,
          endsAt: ends,
        };
      }
      return { kind: "active", renewsInDays: daysLeft, endsAt: ends };
    }
    case "frozen": {
      if (!row.frozen_until) {
        // Sentinel inconsistency — treat as active so the card doesn't crash.
        return row.current_period_ends_at
          ? deriveStatus({ ...row, status: "active" } as SubscriptionRow, now)
          : { kind: "lapsed" };
      }
      const until = new Date(row.frozen_until);
      if (until.getTime() <= now.getTime()) {
        // Freeze elapsed; current_period_ends_at was already extended at freeze
        // creation time, so deriving as 'active' is correct. The caller will
        // write back status='active' on its next pass.
        return row.current_period_ends_at
          ? deriveStatus({ ...row, status: "active" } as SubscriptionRow, now)
          : { kind: "lapsed" };
      }
      return { kind: "frozen", untilDate: until };
    }
    case "trial_expired":
      return { kind: "trial_expired" };
    case "lapsed":
      return { kind: "lapsed" };
    case "payment_failed":
      return { kind: "payment_failed" };
  }
}

/**
 * Reads the row, derives the current state, and lazily writes back any
 * transitions that have crossed a time boundary since the last access.
 * Hot path: called from the home-screen summary fetch and the access gate.
 *
 * Writebacks are best-effort — if the update fails the next call retries.
 */
export async function getStatus(
  userId: number,
): Promise<{ raw: SubscriptionRow; derived: DerivedStatus } | null> {
  const sb = getServiceRoleClient();
  const { data: raw } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!raw) return null;

  const now = new Date();
  const derived = deriveStatus(raw, now);
  await maybeWriteBackTransitions(raw, derived);
  return { raw, derived };
}

async function maybeWriteBackTransitions(
  raw: SubscriptionRow,
  derived: DerivedStatus,
): Promise<void> {
  // Only write when the row's stored status disagrees with what's now true.
  let nextStatus: SubscriptionStatus | null = null;
  if (raw.status === "trial" && derived.kind === "trial_expired") {
    nextStatus = "trial_expired";
  } else if (raw.status === "active" && derived.kind === "lapsed") {
    nextStatus = "lapsed";
  } else if (
    raw.status === "frozen" &&
    (derived.kind === "active" ||
      derived.kind === "renewing_soon" ||
      derived.kind === "lapsed")
  ) {
    // Freeze elapsed; settle the row to the post-freeze status.
    nextStatus = derived.kind === "lapsed" ? "lapsed" : "active";
  }
  if (!nextStatus) return;
  const sb = getServiceRoleClient();
  await sb
    .from("subscriptions")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("user_id", raw.user_id);
}
