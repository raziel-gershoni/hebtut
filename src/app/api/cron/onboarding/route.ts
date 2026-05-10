import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  advanceOnboarding,
  computeOnboardingDay,
  markOnboardingDone,
  markTimerFired,
  sendStep5Nudge2h,
  sendStep6Nudge24h,
  sendStep8MetaExplainer,
  sendStep9Day1LimitDone,
  sendStep10PauseNudge,
  sendStep11Day2Conversion,
  sendStep12Survey,
  sendStep12_3Video3,
} from "@/server/onboarding";
import { localDateInTz } from "@/lib/time";
import { nextWindowOpen } from "@/server/response-window";
import type { Database, OnboardingTimerKind } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Sub = Database["public"]["Tables"]["subscriptions"]["Row"];

const PAUSE_INACTIVITY_MS = 6 * 60 * 60 * 1000;

/**
 * Every-minute cron driving the onboarding tree's time-based fires. Two
 * passes per tick:
 *
 *   1) Drain due `onboarding_timers` rows. Each kind dispatches to the
 *      matching `send*` function; state mismatches (the user moved on
 *      since the timer was scheduled) silently mark the timer fired with
 *      no DM — keeping the queue clean without sending stale nudges.
 *   2) Day-2+ pause-nudge sweep (Step 10). For each student in an active
 *      onboarding state, with onboarding day ≥ 2, no activity for 6h, and
 *      no pause-nudge already sent today (in the user's tz), AND inside
 *      the student's response_window (or fallback 08–22): send Step 10.
 */
async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Pass 1: drain due timers.
  const { data: due } = await sb
    .from("onboarding_timers")
    .select("student_id, kind")
    .is("fired_at", null)
    .is("cancelled_at", null)
    .lte("due_at", nowIso)
    .limit(200);

  let firedCount = 0;
  let staleCount = 0;
  for (const row of due ?? []) {
    const handled = await dispatchTimer(row.student_id, row.kind);
    if (handled) firedCount++;
    else staleCount++;
    await markTimerFired(row.student_id, row.kind);
  }

  // Pass 2: day-2+ pause sweep. Pull candidate rows in one query and filter
  // in JS — keeps the SQL side simple and the per-row cost is small.
  const { data: candidates } = await sb
    .from("subscriptions")
    .select("*")
    .in("onboarding_state", [
      "awaiting_first_reply",
      "meta_explainer_pending",
      "day1_active",
      "day2_active",
    ])
    .lt(
      "onboarding_last_active_at",
      new Date(now.getTime() - PAUSE_INACTIVITY_MS).toISOString(),
    );
  let pauseNudges = 0;
  for (const row of (candidates ?? []) as Sub[]) {
    if (await maybeSendPauseNudge(row, now)) pauseNudges++;
  }

  return Response.json({
    timers_fired: firedCount,
    timers_stale: staleCount,
    pause_nudges_sent: pauseNudges,
  });
}

/**
 * Returns true if a real DM was sent (i.e. state matched the timer's
 * intent). Returns false if the user moved on — caller still marks the
 * timer fired so we don't re-evaluate it on every tick.
 */
async function dispatchTimer(
  studentId: number,
  kind: OnboardingTimerKind,
): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("onboarding_state, trial_started_at, onboarding_day1_limit_msg_sent_at")
    .eq("user_id", studentId)
    .maybeSingle();
  if (!row) return false;
  const state = row.onboarding_state;

  switch (kind) {
    case "nudge_2h":
    case "nudge_24h":
      // Only fire if the student is still in cta_record. Once they record
      // their first voice the bypass branch in student-message.ts cancels
      // these timers — but a race with cron could arrive here anyway.
      if (state !== "cta_record") return false;
      if (kind === "nudge_2h") await sendStep5Nudge2h(studentId);
      else await sendStep6Nudge24h(studentId);
      return true;
    case "meta_explainer":
      // Only when the student is still in meta_explainer_pending. If a
      // payment landed in the meantime, state is done_paid → skip.
      if (state !== "meta_explainer_pending") return false;
      await sendStep8MetaExplainer(studentId);
      // Move forward into day1_active so the day-2+ pause sweep starts
      // tracking inactivity from this point on.
      await advanceOnboarding(studentId, "day1_active");
      return true;
    case "day2_conversion":
      if (state !== "day2_conversion_pending") return false;
      await sendStep11Day2Conversion(studentId);
      // Do NOT advance to a terminal state here — the survey timer (set
      // by the subscriptions cron at trial_expired) drives the next move.
      return true;
    case "survey":
      if (state !== "awaiting_survey") return false;
      await sendStep12Survey(studentId);
      return true;
    case "churn_followup":
      if (state !== "survey_later") return false;
      await sendStep12_3Video3(studentId);
      // 5d after Later with no payment ≈ churned. Mark done so the timer
      // doesn't re-fire and any outstanding state is cleaned up.
      await markOnboardingDone(studentId, "churned");
      return true;
  }
}

/**
 * Step 10 pause-nudge gate: returns true if a DM was sent.
 *
 * Conditions (all must hold):
 *   - onboarding day ≥ 2 in user tz
 *   - last_active_at exists and is more than 6h ago
 *   - no pause nudge sent today (in user tz)
 *   - now is inside the student's response_window OR within fallback 08–22
 */
async function maybeSendPauseNudge(row: Sub, now: Date): Promise<boolean> {
  const tz = row.response_window_tz;
  const day = computeOnboardingDay(row.trial_started_at, now, tz);
  if (day < 2) return false;
  if (!row.onboarding_last_active_at) return false;

  // Dedup: already sent today (calendar day in user tz).
  const todayLocal = localDateInTz(now, tz);
  const lastNudgeLocal = row.onboarding_last_pause_nudge_at
    ? localDateInTz(new Date(row.onboarding_last_pause_nudge_at), tz)
    : null;
  if (lastNudgeLocal === todayLocal) return false;

  // Quiet-hour respect: use student's window, fallback to 08–22.
  const start = row.response_window_start ?? "08:00";
  const end = row.response_window_end ?? "22:00";
  if (nextWindowOpen(now, start, end, tz) !== null) return false;

  await sendStep10PauseNudge(row.user_id);
  const sb = getServiceRoleClient();
  const stamp = now.toISOString();
  await sb
    .from("subscriptions")
    .update({
      onboarding_last_pause_nudge_at: stamp,
      updated_at: stamp,
    })
    .eq("user_id", row.user_id);
  return true;
}

// Suppress unused warnings — sendStep9 is referenced from student-message.ts;
// keeping the import here would surface duplicates if added by mistake.
void sendStep9Day1LimitDone;

export { handler as GET, handler as POST };
