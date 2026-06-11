import { addDays } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Database, SubscriptionStatus } from "@/types/database";
import { recordAudit } from "@/server/audit";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { markOnboardingDone } from "@/server/onboarding";
import { getReferralsEnabled } from "@/server/settings";

const REFERRER_BONUS_CAP_DAYS = 90;
const REFERRAL_BONUS_PER_SIDE_DAYS = 30;
export const FREEZE_BUDGET_DAYS_PER_MONTH = 3;

/**
 * Whether a successful payment should grant the referral bonus. All three
 * must hold: the program is enabled, this is the referee's first paid
 * period, and they were attributed to a referrer. Gating this one value
 * short-circuits BOTH the referee bonus and the referrer credit.
 */
export function shouldApplyReferralBonus(
  referralsEnabled: boolean,
  wasFirstPaid: boolean,
  referredByUserId: number | null,
): boolean {
  return referralsEnabled && wasFirstPaid && referredByUserId != null;
}

/**
 * Returns the freeze budget remaining for THIS calendar month, lazily
 * resetting `freeze_days_used_in_period` when the month rolls over since
 * the last reset. Pure but the writeback is async — pulls + recomputes from
 * the row, then writes back the reset if needed.
 *
 * TODO(tz-budget): Roll-over check uses UTC month boundaries, so a student
 * in Auckland/Apia near month-end sees their budget reset up to ~14h early
 * or late vs. their local calendar. Subscriptions already store
 * response_window_tz; using that here would be a small follow-up.
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
  | { kind: "queued" }
  | { kind: "trial"; daysLeft: number; endsAt: Date }
  | { kind: "trial_ending"; daysLeft: 0 | 1; endsAt: Date }
  | { kind: "active"; renewsInDays: number; endsAt: Date }
  | { kind: "renewing_soon"; renewsInDays: 0 | 1 | 2; endsAt: Date }
  | { kind: "trial_expired" }
  | { kind: "lapsed" }
  | { kind: "payment_failed" }
  | { kind: "frozen"; untilDate: Date };

/** True for queued / trial / trial_ending / active / renewing_soon — the states where the bot accepts media. */
export function canSendMedia(d: DerivedStatus): boolean {
  return (
    d.kind === "queued" ||
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
    case "queued":
      return { kind: "queued" };
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
 * the initial backfill), one is provisioned with the default 2-day trial
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
  const existingEnd = pickPaymentAnchor(row, now);
  const baseEnd = addDays(existingEnd, input.periodDays);
  const wasFirstPaid = row.current_period_starts_at == null;

  // Compute the FINAL end date up front so the audit row records the same
  // value the row will hold post-update. Pre-fix this happened in two
  // separate updates with the audit captured between them, leaving a
  // diagnostic mismatch when referral bonus applied.
  const referralsEnabled = await getReferralsEnabled();
  const refereeWillGetReferralBonus = shouldApplyReferralBonus(
    referralsEnabled,
    wasFirstPaid,
    row.referred_by_user_id,
  );
  const refereeFinalEnd = refereeWillGetReferralBonus
    ? addDays(baseEnd, REFERRAL_BONUS_PER_SIDE_DAYS)
    : baseEnd;

  await sb
    .from("subscriptions")
    .update({
      status: "active",
      current_period_starts_at: row.current_period_starts_at ?? now.toISOString(),
      current_period_ends_at: refereeFinalEnd.toISOString(),
      next_renewal_at: refereeFinalEnd.toISOString(),
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
      // Reflects the row's final state (incl. referral bonus when it applied).
      new_period_ends_at: refereeFinalEnd.toISOString(),
      referral_bonus_applied: refereeWillGetReferralBonus,
    },
  });

  // Referrer-side credit — only on referee's FIRST successful paid period.
  // Capped at REFERRER_BONUS_CAP_DAYS total ever, summed from prior
  // billing.referral_credit audit rows.
  let referrerCreditedDays = 0;
  if (refereeWillGetReferralBonus && row.referred_by_user_id != null) {
    const { data: refRow } = await sb
      .from("subscriptions")
      .select("*")
      .eq("user_id", row.referred_by_user_id)
      .maybeSingle();
    if (refRow) {
      // Cap is per-referrer-lifetime, summed from prior credit-audit rows.
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
        const refNewEnd = addDays(pickPaymentAnchor(refRow, now), grant);
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
  }

  // Mark the onboarding tree finished — done_paid + cancel any survey /
  // churn-followup timers. No-op for users whose onboarding is already
  // done_skipped / done_paid / done_churned.
  await markOnboardingDone(input.userId, "paid");

  return { wasFirstPaid, refereeNewEndsAt: refereeFinalEnd, referrerCreditedDays };
}

/**
 * Pick the date a new period extension should anchor on:
 * - Active or frozen with a future period_ends_at → anchor on that (so paying
 *   mid-period stacks).
 * - Trial with time left → anchor on trial_ends_at (so paying mid-trial
 *   doesn't waste the trial days).
 * - Anything else (lapsed / trial_expired / payment_failed / period in past)
 *   → anchor at `now`.
 *
 * Pure — extracted so the four anchor cases can be unit-tested without DB.
 */
export function pickPaymentAnchor(
  row: Pick<
    SubscriptionRow,
    "status" | "current_period_ends_at" | "trial_ends_at"
  >,
  now: Date,
): Date {
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
}

/* -------------------------------------------------------------------------
 * Admin manual-grant helpers — used by /api/admin/users/[id]/subscription.
 *
 * Each helper writes the row, audits, and DMs the affected student so
 * they immediately know about the change. None of them apply referral
 * credits — admin gifts are NOT conversions; only paid periods (handled
 * in applySuccessfulPayment) trigger referral payouts. This is the
 * locked-in design choice.
 * ----------------------------------------------------------------------- */

const TRIAL_RESET_DAYS = 2;
const MAX_GRANT_DAYS = 3650; // 10 years — clamps obvious typos

/**
 * Extends current_period_ends_at by `days`, anchored on the existing end
 * if in the future, or now() if already lapsed/expired. Sets status='active'.
 * Skips referral logic. Returns the new period end so the caller can
 * surface it in the response and the admin sees confirmation.
 */
export async function grantSubscriptionDays(input: {
  userId: number;
  days: number;
  byAdminId: number;
}): Promise<{ newPeriodEnd: Date } | null> {
  const days = Math.min(MAX_GRANT_DAYS, Math.max(1, Math.floor(input.days)));
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!row) return null;

  const now = new Date();
  const newEnd = addDays(pickPaymentAnchor(row, now), days);

  await sb
    .from("subscriptions")
    .update({
      status: "active",
      current_period_starts_at: row.current_period_starts_at ?? now.toISOString(),
      current_period_ends_at: newEnd.toISOString(),
      next_renewal_at: newEnd.toISOString(),
      // Manual grant clears the in-chat lockout cooldown so the user can
      // immediately reach support if anything's off, and clears the renewal
      // reminder dedupe so the cron will re-evaluate.
      last_lockout_replied_at: null,
      last_renewal_reminder_sent_at: null,
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId);

  await recordAudit({
    action: "admin.subscription_grant",
    actorId: input.byAdminId,
    subjectType: "user",
    subjectId: input.userId,
    meta: {
      days,
      anchor: row.status,
      new_period_ends_at: newEnd.toISOString(),
    },
  });

  await dmStudent(input.userId, ru.bot.subscription.granted(days, formatRu(newEnd)));
  // Admin grants count as "user has access" so onboarding is closed —
  // cancels any pending survey/churn timers + flips state to done_paid.
  await markOnboardingDone(input.userId, "admin_grant");
  return { newPeriodEnd: newEnd };
}

/**
 * Resets the user back to a fresh 2-day trial. Useful when an admin wants
 * to give someone a "second chance" without paying days. Leaves
 * current_period_starts_at intact (so referral logic still treats a future
 * paid period as the user's "first paid").
 */
export async function resetTrialForUser(input: {
  userId: number;
  byAdminId: number;
}): Promise<{ trialEnd: Date } | null> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("user_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!row) return null;

  const now = new Date();
  const trialEnd = addDays(now, TRIAL_RESET_DAYS);
  await sb
    .from("subscriptions")
    .update({
      status: "trial",
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      last_lockout_replied_at: null,
      last_renewal_reminder_sent_at: null,
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId);

  await recordAudit({
    action: "admin.subscription_reset_trial",
    actorId: input.byAdminId,
    subjectType: "user",
    subjectId: input.userId,
    meta: { trial_ends_at: trialEnd.toISOString(), days: TRIAL_RESET_DAYS },
  });

  await dmStudent(input.userId, ru.bot.subscription.reset);
  return { trialEnd };
}

/**
 * Flips a queued student to trial with a fresh clock. Called when the
 * student gets their first tutor link via /api/admin/links. Idempotent
 * by guard — only flips rows currently in 'queued'; later relinks are
 * no-ops.
 */
export async function startTrialOnFirstLink(
  userId: number,
): Promise<{ flipped: boolean; trialEnd?: Date }> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row || row.status !== "queued") return { flipped: false };

  const now = new Date();
  const trialEnd = addDays(now, TRIAL_RESET_DAYS);
  const { error } = await sb
    .from("subscriptions")
    .update({
      status: "trial",
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "queued");
  if (error) {
    console.warn("startTrialOnFirstLink failed", { user_id: userId, reason: error.message });
    return { flipped: false };
  }
  return { flipped: true, trialEnd };
}

/**
 * Closes the subscription immediately. Sets status='lapsed' and pulls
 * current_period_ends_at back to now so the access gate stops accepting
 * media on the next inbound. Doesn't refund anything — this is admin
 * authority, used when a user is being moved off the platform.
 */
export async function lapseSubscription(input: {
  userId: number;
  byAdminId: number;
}): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("user_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!row) return false;

  const now = new Date();
  await sb
    .from("subscriptions")
    .update({
      status: "lapsed",
      current_period_ends_at: now.toISOString(),
      // Don't clear last_lockout_replied_at — the next inbound triggers a
      // fresh locked-template reply (24h window), which is the desired UX.
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId);

  await recordAudit({
    action: "admin.subscription_lapse",
    actorId: input.byAdminId,
    subjectType: "user",
    subjectId: input.userId,
  });

  await dmStudent(input.userId, ru.bot.subscription.lapsed);
  return true;
}

async function dmStudent(userId: number, text: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: u } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", userId)
    .maybeSingle();
  if (!u?.tg_chat_id) return;
  try {
    await getBot().api.sendMessage(u.tg_chat_id, text);
  } catch (e) {
    console.warn("admin subscription DM failed", {
      user_id: userId,
      reason: (e as Error).message,
    });
  }
}

function formatRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
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
