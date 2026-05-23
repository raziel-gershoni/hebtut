import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  advanceOnboarding,
  computeOnboardingDay,
  markOnboardingDone,
  markTimerFired,
  scheduleTimer,
  sendStep5Nudge2h,
  sendStep6Nudge24h,
  sendStep8MetaExplainer,
  sendStep9Day1LimitDone,
  sendStep10PauseNudge,
  sendStep11Day2Conversion,
  sendStep12Survey,
  sendStep12_3Video3,
} from "@/server/onboarding";
import {
  fallbackForStep,
  isStateMatchingStep,
  sendOneClip,
} from "@/server/onboarding-videos";
import { localDateInTz } from "@/lib/time";
import { nextWindowOpen } from "@/server/response-window";
import type {
  Database,
  Json,
  OnboardingTimerKind,
  OnboardingVideoStep,
} from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Sub = Database["public"]["Tables"]["subscriptions"]["Row"];

const PAUSE_INACTIVITY_MS = 6 * 60 * 60 * 1000;

type DispatchResult =
  | { handled: false }
  | {
      handled: true;
      reschedule?: {
        kind: OnboardingTimerKind;
        dueAt: Date;
        meta?: Json | null;
      };
    };

/**
 * Every-minute cron driving the onboarding tree's time-based fires. Two
 * passes per tick:
 *
 *   1) Drain due `onboarding_timers` rows. Each kind dispatches to the
 *      matching `send*` function; state mismatches (the user moved on
 *      since the timer was scheduled) silently mark the timer fired with
 *      no DM — keeping the queue clean without sending stale nudges.
 *      Self-rearming kinds (currently `video_sequence_next`) return a
 *      `reschedule` descriptor; we mark the current row fired first, then
 *      schedule the next so the new row's `fired_at: null` doesn't get
 *      clobbered by markTimerFired.
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
    .select("student_id, kind, meta")
    .is("fired_at", null)
    .is("cancelled_at", null)
    .lte("due_at", nowIso)
    .limit(200);

  let firedCount = 0;
  let staleCount = 0;
  for (const row of due ?? []) {
    const result = await dispatchTimer(row.student_id, row.kind, row.meta);
    // Mark current row fired BEFORE scheduling the next — otherwise the
    // upsert in scheduleTimer would set the new row's fired_at to null and
    // markTimerFired (running after) would mark THAT row fired instead of
    // the one we just dispatched. See "Self-rearming timers" in the plan.
    await markTimerFired(row.student_id, row.kind);
    if (result.handled) {
      firedCount++;
      if (result.reschedule) {
        await scheduleTimer(
          row.student_id,
          result.reschedule.kind,
          result.reschedule.dueAt,
          result.reschedule.meta ?? null,
        );
      }
    } else {
      staleCount++;
    }
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
 * Returns `{handled: true}` when a real DM was sent (i.e. state matched
 * the timer's intent), with an optional `reschedule` descriptor for kinds
 * that self-rearm. Returns `{handled: false}` when the user moved on —
 * caller still marks the timer fired so we don't re-evaluate it.
 */
async function dispatchTimer(
  studentId: number,
  kind: OnboardingTimerKind,
  meta: Json | null,
): Promise<DispatchResult> {
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("onboarding_state, trial_started_at, onboarding_day1_limit_msg_sent_at")
    .eq("user_id", studentId)
    .maybeSingle();
  if (!row) return { handled: false };
  const state = row.onboarding_state;

  switch (kind) {
    case "nudge_2h":
    case "nudge_24h":
      // Only fire if the student is still in cta_record. Once they record
      // their first voice the bypass branch in student-message.ts cancels
      // these timers — but a race with cron could arrive here anyway.
      if (state !== "cta_record") return { handled: false };
      if (kind === "nudge_2h") await sendStep5Nudge2h(studentId);
      else await sendStep6Nudge24h(studentId);
      return { handled: true };
    case "meta_explainer":
      // Only when the student is still in meta_explainer_pending. If a
      // payment landed in the meantime, state is done_paid → skip.
      if (state !== "meta_explainer_pending") return { handled: false };
      await sendStep8MetaExplainer(studentId);
      // Move forward into day1_active so the day-2+ pause sweep starts
      // tracking inactivity from this point on.
      await advanceOnboarding(studentId, "day1_active");
      return { handled: true };
    case "day2_conversion":
      if (state !== "day2_conversion_pending") return { handled: false };
      await sendStep11Day2Conversion(studentId);
      // Do NOT advance to a terminal state here — the survey timer (set
      // by the subscriptions cron at trial_expired) drives the next move.
      return { handled: true };
    case "survey":
      if (state !== "awaiting_survey") return { handled: false };
      await sendStep12Survey(studentId);
      return { handled: true };
    case "churn_followup":
      if (state !== "survey_later") return { handled: false };
      await sendStep12_3Video3(studentId);
      // 5d after Later with no payment ≈ churned. Mark done so the timer
      // doesn't re-fire and any outstanding state is cleaned up.
      await markOnboardingDone(studentId, "churned");
      return { handled: true };
    case "video_sequence_next":
      return dispatchVideoSequenceNext(studentId, state, meta);
  }
}

/**
 * Drip-sends the next clip in an onboarding video sequence. Stale-checks
 * the student's state, looks up the row by `(step, next_position)`, sends
 * it with the Continue button attached IFF this is the last clip, and
 * returns a reschedule descriptor pointing at the next position when more
 * remain. Gaps (deleted middle clip) are skipped silently.
 */
async function dispatchVideoSequenceNext(
  studentId: number,
  state: Database["public"]["Tables"]["subscriptions"]["Row"]["onboarding_state"],
  meta: Json | null,
): Promise<DispatchResult> {
  const payload = (meta ?? {}) as {
    step?: OnboardingVideoStep;
    next_position?: number;
  };
  if (!payload.step || !payload.next_position) {
    return { handled: false };
  }
  if (!isStateMatchingStep(state, payload.step)) {
    return { handled: false };
  }

  const sb = getServiceRoleClient();
  const { data: u } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!u?.tg_chat_id) return { handled: false };

  const { data: rows } = await sb
    .from("onboarding_videos")
    .select("id, position, storage_path, tg_file_id, tg_file_unique_id")
    .eq("step", payload.step)
    .order("position", { ascending: true });
  if (!rows || rows.length === 0) return { handled: false };

  const clip = rows.find((r) => r.position === payload.next_position);
  // Gap (e.g. position 3 was deleted while position 2 was queued). Look
  // for the next existing position above the requested one; if any exists
  // we reschedule to it, otherwise the sequence is done.
  if (!clip) {
    const nextExisting = rows.find((r) => r.position > payload.next_position!);
    if (!nextExisting) return { handled: true };
    return {
      handled: true,
      reschedule: {
        kind: "video_sequence_next",
        dueAt: new Date(),
        meta: { step: payload.step, next_position: nextExisting.position },
      },
    };
  }

  const fallback = fallbackForStep(payload.step);
  const lastClip = rows[rows.length - 1];
  const isLast = lastClip != null && clip.position === lastClip.position;
  const reply_markup =
    isLast && fallback.buttons
      ? { inline_keyboard: fallback.buttons }
      : undefined;

  await sendOneClip({
    studentId,
    chatId: u.tg_chat_id,
    step: payload.step,
    row: {
      id: clip.id,
      position: clip.position,
      storage_path: clip.storage_path,
      tg_file_id: clip.tg_file_id,
      tg_file_unique_id: clip.tg_file_unique_id,
    },
    reply_markup,
  });

  if (isLast) return { handled: true };
  const nextPos = rows.find((r) => r.position > clip.position)?.position;
  if (nextPos == null) return { handled: true };
  return {
    handled: true,
    reschedule: {
      kind: "video_sequence_next",
      dueAt: new Date(),
      meta: { step: payload.step, next_position: nextPos },
    },
  };
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
