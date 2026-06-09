import { addDays, format, parseISO } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";
import { serverEnv } from "@/lib/env";

export function computeRemaining(usedSeconds: number, budgetSeconds: number): number {
  return Math.max(0, budgetSeconds - usedSeconds);
}

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

export interface QuotaInput {
  usedToday: number;
  dailyQuota: number;
  graceSeconds: number;
  messageDuration: number;
}

export type QuotaDecision =
  | {
      ok: true;
      todayDebit: number;
      tomorrowDebit: number;
      newRemainingToday: number;
    }
  | { ok: false; reason: "no-room"; remainingIncludingGrace: number };

/**
 * Pure quota decision: given today's usage and an incoming message duration,
 * decide whether to accept it and how to split between today and tomorrow.
 *
 * Grace is single-shot per day: the FIRST message whose tail crosses
 * `dailyQuota` into the grace window is accepted, and the entire message is
 * charged today (so today's bucket is now over-quota and signals that grace
 * has been used). The portion beyond `dailyQuota` is also debited from
 * tomorrow's bucket. Any subsequent message — once `usedToday > dailyQuota` —
 * is rejected outright. Messages too long to fit the remaining
 * `quota + grace` headroom are also rejected.
 */
export function decideQuota(input: QuotaInput): QuotaDecision {
  const { usedToday, dailyQuota, graceSeconds, messageDuration } = input;
  // Single-shot grace: any prior message that already crossed today's quota
  // means no more messages today, full stop.
  if (usedToday > dailyQuota) {
    return { ok: false, reason: "no-room", remainingIncludingGrace: 0 };
  }
  const totalAllowed = dailyQuota + graceSeconds;
  const remainingIncludingGrace = Math.max(0, totalAllowed - usedToday);
  if (messageDuration > remainingIncludingGrace) {
    return { ok: false, reason: "no-room", remainingIncludingGrace };
  }
  // Accept: the whole message counts against today (so usedToday crosses
  // into the grace zone and locks out further messages); the part beyond
  // the daily quota is also debited from tomorrow's bucket.
  const overflow = Math.max(0, usedToday + messageDuration - dailyQuota);
  const todayDebit = messageDuration;
  const tomorrowDebit = overflow;
  const newRemainingToday = Math.max(0, dailyQuota - (usedToday + messageDuration));
  return { ok: true, todayDebit, tomorrowDebit, newRemainingToday };
}

export async function getUsedForToday(studentId: number, tz: string): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  const { data } = await sb
    .from("quota_usage")
    .select("seconds_used")
    .eq("student_id", studentId)
    .eq("date", today)
    .maybeSingle();
  return data?.seconds_used ?? 0;
}

export async function getRemainingForToday(studentId: number, tz: string): Promise<number> {
  const used = await getUsedForToday(studentId, tz);
  return computeRemaining(used, serverEnv.DAILY_QUOTA_SECONDS);
}

/**
 * Pure: group user ids by their tz, defaulting missing entries to UTC.
 */
export function groupUserIdsByTz(
  userIds: number[],
  tzByUser: Map<number, string>,
): Map<string, number[]> {
  const idsByTz = new Map<string, number[]>();
  for (const id of userIds) {
    const tz = tzByUser.get(id) ?? "UTC";
    const bucket = idsByTz.get(tz) ?? [];
    bucket.push(id);
    idsByTz.set(tz, bucket);
  }
  return idsByTz;
}

/**
 * Pure: compute the final user→signedRemaining map from a usage lookup.
 */
export function computeSignedRemainingMap(
  userIds: number[],
  usedByUser: Map<number, number>,
  budgetSeconds: number,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of userIds) {
    out.set(id, computeSignedRemaining(usedByUser.get(id) ?? 0, budgetSeconds));
  }
  return out;
}

/**
 * Tutor-facing helper. Returns signed remaining seconds today for many users
 * in one shot, batching the quota_usage SELECT per unique timezone. Missing
 * tz → defaults to UTC. Users with no quota_usage row today → full cap.
 * Negative values indicate over-quota by abs(value).
 */
export async function getSignedRemainingForManyToday(
  userIds: number[],
): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();

  const sb = getServiceRoleClient();

  // 1. Fetch tz for all requested users.
  const { data: tzRows } = await sb
    .from("users")
    .select("id, tz")
    .in("id", userIds);
  const tzByUser = new Map<number, string>(
    (tzRows ?? []).map((r) => [r.id, r.tz ?? "UTC"]),
  );

  // 2. Group ids by tz.
  const idsByTz = groupUserIdsByTz(userIds, tzByUser);

  // 3. Query quota_usage once per tz, accumulate usage.
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

  // 4. Compute and return the final signed-remaining map.
  return computeSignedRemainingMap(userIds, usedByUser, serverEnv.DAILY_QUOTA_SECONDS);
}

/**
 * Adds `todayDebit` seconds to today's row and `tomorrowDebit` to tomorrow's,
 * upserting both. Either may be zero. Returns the post-commit remaining for
 * today (clamped at zero).
 */
export async function commitUsageSplit(
  studentId: number,
  tz: string,
  todayDebit: number,
  tomorrowDebit: number,
): Promise<number> {
  const sb = getServiceRoleClient();
  const todayStr = localDateInTz(new Date(), tz);
  const tomorrowStr = format(addDays(parseISO(todayStr), 1), "yyyy-MM-dd");

  if (todayDebit > 0) {
    const { data: existing } = await sb
      .from("quota_usage")
      .select("seconds_used")
      .eq("student_id", studentId)
      .eq("date", todayStr)
      .maybeSingle();
    await sb.from("quota_usage").upsert(
      {
        student_id: studentId,
        date: todayStr,
        seconds_used: (existing?.seconds_used ?? 0) + todayDebit,
      },
      { onConflict: "student_id,date" },
    );
  }

  if (tomorrowDebit > 0) {
    const { data: existing } = await sb
      .from("quota_usage")
      .select("seconds_used")
      .eq("student_id", studentId)
      .eq("date", tomorrowStr)
      .maybeSingle();
    await sb.from("quota_usage").upsert(
      {
        student_id: studentId,
        date: tomorrowStr,
        seconds_used: (existing?.seconds_used ?? 0) + tomorrowDebit,
      },
      { onConflict: "student_id,date" },
    );
  }

  return getRemainingForToday(studentId, tz);
}
