import { addDays } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Database, SubscriptionStatus } from "@/types/database";
import { recordAudit } from "@/server/audit";

const REFERRER_BONUS_CAP_DAYS = 90;
const REFERRAL_BONUS_PER_SIDE_DAYS = 30;
export const FREEZE_BUDGET_DAYS_PER_MONTH = 3;

/**
 * Returns the freeze budget remaining for THIS calendar month, lazily
 * resetting `freeze_days_used_in_period` when the month rolls over since
 * the last reset. Pure but the writeback is async — pulls + recomputes from
 * the row, then writes back the reset if needed.
 */
export async function lazyResetFreezeBudget(userId: number): Promise<number> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("freeze_days_used_in_period, freeze_period_started_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return FREEZE_BUDGET_DAYS_PER_MONTH;

  const now = new Date();
  const lastReset = row.freeze_period_started_at
    ? new Date(row.freeze_period_started_at)
    : null;
  const monthRolledOver =
    !lastReset ||
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth();
  if (monthRolledOver) {
    await sb
      .from("subscriptions")
      .update({
        freeze_days_used_in_period: 0,
        freeze_period_started_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("user_id", userId);
    return FREEZE_BUDGET_DAYS_PER_MONTH;
  }
  return Math.max(
    0,
    FREEZE_BUDGET_DAYS_PER_MONTH - (row.freeze_days_used_in_period ?? 0),
  );
}

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
 * If the user has no subscription row yet (e.g., a student created after
 * the initial backfill), one is provisioned with the default 3-day trial
 * starting now. This keeps the access gate & the home card consistent for
 * every student, regardless of when they joined.
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
  if (!raw) {
    // Provision a fresh trial. We INSERT (not UPSERT) so we audit the
    // creation distinctly from a re-read. Race-safe: a duplicate insert from
    // a concurrent caller raises a primary-key conflict; we catch and re-read.
    const { error } = await sb
      .from("subscriptions")
      .insert({ user_id: userId });
    if (error && error.code !== "23505") {
      console.warn("subscription provisioning failed", {
        user_id: userId,
        reason: error.message,
      });
      return null;
    }
    const { data: provisioned } = await sb
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!provisioned) return null;
    return { raw: provisioned, derived: deriveStatus(provisioned, new Date()) };
  }

  const now = new Date();
  const derived = deriveStatus(raw, now);
  await maybeWriteBackTransitions(raw, derived);
  return { raw, derived };
}

/**
 * Applies a confirmed successful payment to the subscription row:
 * extends `current_period_ends_at` by `periodDays` (treating the existing end
 * as the anchor when in the future, or now() when already lapsed), flips
 * status to 'active', records the provider payment ID, clears the lockout
 * cooldown, and on first paid period applies referral credits to both sides.
 *
 * Returns `{ wasFirstPaid, refereeNewEndsAt }` so the webhook can DM the
 * student a confirmation with the right date.
 */
export async function applySuccessfulPayment(input: {
  userId: number;
  periodDays: number;
  provider: "tg_stars" | "tg_payments" | "stripe";
  providerPaymentId: string;
}): Promise<
  | { wasFirstPaid: boolean; refereeNewEndsAt: Date; referrerCreditedDays: number }
  | null
> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!row) return null;

  const now = new Date();
  // Anchor: if the user is currently active or trial-with-time-left, extend
  // from the existing end. Otherwise (lapsed, trial_expired, payment_failed),
  // anchor at "now" — they're not in a current period.
  const existingEnd = (() => {
    if (
      (row.status === "active" || row.status === "frozen") &&
      row.current_period_ends_at &&
      new Date(row.current_period_ends_at) > now
    ) {
      return new Date(row.current_period_ends_at);
    }
    if (row.status === "trial" && new Date(row.trial_ends_at) > now) {
      return new Date(row.trial_ends_at);
    }
    return now;
  })();
  const newEnd = addDays(existingEnd, input.periodDays);

  // First paid period = no current_period_starts_at yet.
  const wasFirstPaid = row.current_period_starts_at == null;

  await sb
    .from("subscriptions")
    .update({
      status: "active",
      current_period_starts_at: row.current_period_starts_at ?? now.toISOString(),
      current_period_ends_at: newEnd.toISOString(),
      next_renewal_at: newEnd.toISOString(),
      provider: input.provider,
      provider_subscription_id: input.providerPaymentId,
      last_lockout_replied_at: null,
      last_renewal_reminder_sent_at: null,
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId);

  await recordAudit({
    action: "billing.payment_succeeded",
    actorId: input.userId,
    subjectType: "user",
    subjectId: input.userId,
    meta: {
      provider: input.provider,
      provider_payment_id: input.providerPaymentId,
      period_days: input.periodDays,
      first_paid_period: wasFirstPaid,
      new_period_ends_at: newEnd.toISOString(),
    },
  });

  // Referral credits — only on the user's FIRST successful paid period, and
  // only if they were referred. Both sides get +30d; the referrer caps at
  // +90d total credit ever, so we look up how much they've already received.
  let referrerCreditedDays = 0;
  if (wasFirstPaid && row.referred_by_user_id) {
    const refereeNewEndAfterCredit = addDays(newEnd, REFERRAL_BONUS_PER_SIDE_DAYS);
    await sb
      .from("subscriptions")
      .update({
        current_period_ends_at: refereeNewEndAfterCredit.toISOString(),
        next_renewal_at: refereeNewEndAfterCredit.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("user_id", input.userId);

    // Look up the referrer; bump their period_ends or trial_ends as needed.
    const { data: refRow } = await sb
      .from("subscriptions")
      .select("*")
      .eq("user_id", row.referred_by_user_id)
      .maybeSingle();
    if (refRow) {
      // Audit how much referral credit has already been granted to enforce the cap.
      const { data: priorAudits } = await sb
        .from("audit_events")
        .select("meta")
        .eq("action", "billing.referral_credit")
        .eq("actor_id", refRow.user_id);
      const alreadyGranted = (priorAudits ?? []).reduce((acc, ev) => {
        const meta = ev.meta as { credited_days?: unknown } | null;
        const days = typeof meta?.credited_days === "number" ? meta.credited_days : 0;
        return acc + days;
      }, 0);
      const remainingCap = Math.max(0, REFERRER_BONUS_CAP_DAYS - alreadyGranted);
      const grant = Math.min(REFERRAL_BONUS_PER_SIDE_DAYS, remainingCap);
      if (grant > 0) {
        const refExistingEnd = (() => {
          if (
            refRow.current_period_ends_at &&
            new Date(refRow.current_period_ends_at) > now
          ) {
            return new Date(refRow.current_period_ends_at);
          }
          if (refRow.status === "trial" && new Date(refRow.trial_ends_at) > now) {
            return new Date(refRow.trial_ends_at);
          }
          return now;
        })();
        const refNewEnd = addDays(refExistingEnd, grant);
        const refIsActive =
          refRow.status === "active" || refRow.status === "frozen";
        // Don't downgrade the referrer's status — only push their end out.
        // If they're trial/lapsed/etc., still extend current_period_ends_at
        // so when they pay it stacks on top.
        await sb
          .from("subscriptions")
          .update({
            current_period_ends_at: refNewEnd.toISOString(),
            next_renewal_at: refIsActive ? refNewEnd.toISOString() : refRow.next_renewal_at,
            updated_at: now.toISOString(),
          })
          .eq("user_id", refRow.user_id);
        await recordAudit({
          action: "billing.referral_credit",
          actorId: refRow.user_id,
          subjectType: "user",
          subjectId: refRow.user_id,
          meta: {
            referee_user_id: input.userId,
            credited_days: grant,
            cap_remaining_after: remainingCap - grant,
            new_period_ends_at: refNewEnd.toISOString(),
          },
        });
        referrerCreditedDays = grant;
      }
    }

    return {
      wasFirstPaid,
      refereeNewEndsAt: refereeNewEndAfterCredit,
      referrerCreditedDays,
    };
  }

  return { wasFirstPaid, refereeNewEndsAt: newEnd, referrerCreditedDays: 0 };
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
