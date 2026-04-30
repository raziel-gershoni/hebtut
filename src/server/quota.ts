import { addDays, format, parseISO } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";
import { serverEnv } from "@/lib/env";

export function computeRemaining(usedSeconds: number, budgetSeconds: number): number {
  return Math.max(0, budgetSeconds - usedSeconds);
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
 * Soft cap is `dailyQuota`; messages that push usage into the
 * [dailyQuota, dailyQuota + graceSeconds] window are still accepted today,
 * but the portion beyond `dailyQuota` is recorded as tomorrow-debit so
 * tomorrow's bucket starts that much smaller. Anything beyond the grace
 * window is rejected outright.
 */
export function decideQuota(input: QuotaInput): QuotaDecision {
  const { usedToday, dailyQuota, graceSeconds, messageDuration } = input;
  const totalAllowed = dailyQuota + graceSeconds;
  const remainingIncludingGrace = Math.max(0, totalAllowed - usedToday);
  if (messageDuration > remainingIncludingGrace) {
    return { ok: false, reason: "no-room", remainingIncludingGrace };
  }
  const todayRoom = Math.max(0, dailyQuota - usedToday);
  const todayDebit = Math.min(messageDuration, todayRoom);
  const tomorrowDebit = messageDuration - todayDebit;
  const newRemainingToday = Math.max(0, dailyQuota - (usedToday + todayDebit));
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
