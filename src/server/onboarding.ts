import { differenceInCalendarDays, parseISO } from "date-fns";
import { localDateInTz } from "@/lib/time";
import { nextWindowOpen } from "@/server/response-window";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";
import { serverEnv } from "@/lib/env";
import type { OnboardingState, OnboardingTimerKind } from "@/types/database";
import type { InlineKeyboardButton } from "grammy/types";
import { sendOnboardingVideoOrFallback } from "@/server/onboarding-videos";

/* -------------------------------------------------------------------------
 * Pure helpers — easy to unit-test, no side effects.
 * ----------------------------------------------------------------------- */

/**
 * 1 on day-of-trial-start, 2 on the next calendar day in the student's tz,
 * etc. Anchored to LOCAL midnight rollovers, not 24h windows — a student who
 * starts the trial at 23:50 sees day 2 begin 10 minutes later when their
 * clock rolls past midnight.
 *
 * This is what the doc means by "day 1" / "day 2" / "конец 2-го дня": calendar
 * days, in the student's locale.
 */
export function computeOnboardingDay(
  trialStartedAt: string,
  now: Date,
  tz: string,
): number {
  const startLocal = parseISO(localDateInTz(new Date(trialStartedAt), tz));
  const nowLocal = parseISO(localDateInTz(now, tz));
  const diff = differenceInCalendarDays(nowLocal, startLocal);
  return Math.max(1, diff + 1);
}

const FALLBACK_WAKE_HOUR = "08:00";
const FALLBACK_SLEEP_HOUR = "22:00";

/**
 * "When is it safe to fire this nudge?" — Step 6 says don't DM at night.
 * If the student has set a response_window, defer outside-window fires to
 * the next opening. Otherwise fall back to 08:00–22:00 in their tz so we
 * never DM at 03:00 unsolicited.
 *
 * Returns `due` unchanged when it's already in a safe window. Otherwise
 * returns the next safe instant.
 */
export function nextSafeFireTime(
  due: Date,
  windowStart: string | null,
  windowEnd: string | null,
  tz: string,
): Date {
  const start = windowStart ?? FALLBACK_WAKE_HOUR;
  const end = windowEnd ?? FALLBACK_SLEEP_HOUR;
  const next = nextWindowOpen(due, start, end, tz);
  return next ?? due;
}

/* -------------------------------------------------------------------------
 * State transitions — DB writes. Each is idempotent within reason; callers
 * are expected to know the desired target state. The cron + handlers
 * enforce ordering.
 * ----------------------------------------------------------------------- */

export async function advanceOnboarding(
  studentId: number,
  next: OnboardingState,
): Promise<void> {
  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  // Upsert (not update) so the row is provisioned for any legacy student
  // that signed up before `createStudent` started provisioning subscriptions
  // automatically. Without this, advancing the state for such a student
  // would be a silent no-op and the callback handler would keep defaulting
  // their state to 'done_skipped'.
  await sb
    .from("subscriptions")
    .upsert(
      {
        user_id: studentId,
        onboarding_state: next,
        onboarding_state_entered_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
}

export async function scheduleTimer(
  studentId: number,
  kind: OnboardingTimerKind,
  dueAt: Date,
): Promise<void> {
  const sb = getServiceRoleClient();
  // Upsert: rescheduling an unfired timer overwrites due_at + clears the
  // soft-cancel flag. A timer that's already fired stays fired (we don't
  // re-arm a delivered nudge automatically — the caller would advance state
  // first, which usually changes which timer is next anyway).
  await sb.from("onboarding_timers").upsert(
    {
      student_id: studentId,
      kind,
      due_at: dueAt.toISOString(),
      fired_at: null,
      cancelled_at: null,
    },
    { onConflict: "student_id,kind" },
  );
}

export async function cancelTimer(
  studentId: number,
  kind: OnboardingTimerKind,
): Promise<void> {
  const sb = getServiceRoleClient();
  await sb
    .from("onboarding_timers")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .eq("kind", kind)
    .is("fired_at", null)
    .is("cancelled_at", null);
}

export async function markTimerFired(
  studentId: number,
  kind: OnboardingTimerKind,
): Promise<void> {
  const sb = getServiceRoleClient();
  await sb
    .from("onboarding_timers")
    .update({ fired_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .eq("kind", kind);
}

/* -------------------------------------------------------------------------
 * Send functions — one per step. Each looks up tg_chat_id, posts the
 * message, audits as `onboarding.step_N`. Errors are logged, not thrown:
 * a TG hiccup must not poison a state transition or a cron tick.
 * ----------------------------------------------------------------------- */

interface SendOpts {
  text: string;
  buttons?: InlineKeyboardButton[][];
  step: string; // audit suffix, e.g. "1_welcome"
}

async function sendOnboardingMessage(
  studentId: number,
  opts: SendOpts,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: u } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!u?.tg_chat_id) return;
  try {
    const reply_markup = opts.buttons
      ? { inline_keyboard: opts.buttons }
      : undefined;
    await getBot().api.sendMessage(u.tg_chat_id, opts.text, { reply_markup });
    await recordAudit({
      action: `onboarding.${opts.step}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
    });
  } catch (e) {
    console.warn("onboarding send failed", {
      student_id: studentId,
      step: opts.step,
      reason: (e as Error).message,
    });
  }
}

const feedbackUrl = (): string =>
  `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=feedback`;

export async function sendStep1Welcome(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep1Welcome,
    buttons: [[{ text: ru.onbStep1Button, callback_data: "onb:start" }]],
    step: "step1_welcome",
  });
}

export async function sendStep2Video1(studentId: number): Promise<void> {
  await sendOnboardingVideoOrFallback(studentId, "video1", {
    text: ru.onbVideo1Placeholder,
    buttons: [[{ text: ru.onbStep2Button, callback_data: "onb:continue" }]],
    auditStep: "step2_video1",
  });
}

export async function sendStep3Video2(studentId: number): Promise<void> {
  await sendOnboardingVideoOrFallback(studentId, "video2", {
    text: ru.onbVideo2Placeholder,
    buttons: [[{ text: ru.onbStep3Button, callback_data: "onb:next" }]],
    auditStep: "step3_video2",
  });
}

export async function sendStep4CtaRecord(studentId: number): Promise<void> {
  // No button — Step 4 expects a voice/video recording, not a tap.
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep4CtaRecord,
    step: "step4_cta_record",
  });
}

/**
 * Step 3.5 — collect first name. No button: student replies with text,
 * captured by `handleOnboardingNameInput` which writes users.name and
 * advances state to cta_record (then sends Step 4).
 */
export async function sendStepNameAsk(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbNameAsk,
    step: "step3_5_name_ask",
  });
}

export async function sendStep5Nudge2h(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep5Nudge2h,
    step: "step5_nudge_2h",
  });
}

export async function sendStep6Nudge24h(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep6Nudge24h,
    step: "step6_nudge_24h",
  });
}

export async function sendStep8MetaExplainer(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep8MetaExplainer,
    step: "step8_meta_explainer",
  });
}

export async function sendStep9Day1LimitDone(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep9Day1LimitDone,
    step: "step9_day1_limit_done",
  });
}

export async function sendStep10PauseNudge(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep10PauseNudge,
    step: "step10_pause_nudge",
  });
}

export async function sendStep11Day2Conversion(studentId: number): Promise<void> {
  // Conversion CTA. The button URL routes through the existing pay/feedback
  // gate logic — when Stars are off (current default), we point at feedback;
  // when on, the in-app PayCTA handles the actual purchase. For a TG-DM
  // button, the cleanest is feedback for now (manual-billing era).
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep11Day2Conversion,
    buttons: [[{ text: ru.onbStep11Button, url: feedbackUrl() }]],
    step: "step11_day2_conversion",
  });
}

export async function sendStep12Survey(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep12Survey,
    buttons: [
      [
        { text: ru.onbSurveyYes, callback_data: "onb:survey:yes" },
        { text: ru.onbSurveyLater, callback_data: "onb:survey:later" },
        { text: ru.onbSurveyNo, callback_data: "onb:survey:no" },
      ],
    ],
    step: "step12_survey",
  });
}

export async function sendStep12_1OpenAccess(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep12_1Yes,
    buttons: [[{ text: ru.onbStep12_1Button, url: feedbackUrl() }]],
    step: "step12_1_open_access",
  });
}

export async function sendStep12_2LaterAck(studentId: number): Promise<void> {
  await sendOnboardingMessage(studentId, {
    text: ru.onbStep12_2Later,
    step: "step12_2_later",
  });
}

export async function sendStep12_3Video3(studentId: number): Promise<void> {
  await sendOnboardingVideoOrFallback(studentId, "video3", {
    text: ru.onbVideo3Placeholder,
    buttons: [[{ text: ru.onbVideo3Button, url: feedbackUrl() }]],
    auditStep: "step12_3_video3",
  });
}

/**
 * Re-sends the current step's message for a student mid-onboarding —
 * called when an in-progress student hits /start again (closed and
 * reopened the bot). Idempotent; the buttons re-attach so they can
 * continue the flow. Returns true if a step was re-sent (so the caller
 * can skip the legacy greeting).
 */
export async function resendCurrentOnboardingStep(
  studentId: number,
  state: OnboardingState,
): Promise<boolean> {
  switch (state) {
    case "welcome":
      await sendStep1Welcome(studentId);
      return true;
    case "video1":
      await sendStep2Video1(studentId);
      return true;
    case "video2":
      await sendStep3Video2(studentId);
      return true;
    case "awaiting_name":
      await sendStepNameAsk(studentId);
      return true;
    case "cta_record":
      await sendStep4CtaRecord(studentId);
      return true;
    default:
      return false;
  }
}

/**
 * Closes the onboarding for a student — idempotent. Cancels any pending
 * timers (so a paying user doesn't get a churn-followup, etc.). Audited.
 */
export async function markOnboardingDone(
  studentId: number,
  reason: "paid" | "churned" | "admin_grant",
): Promise<void> {
  const sb = getServiceRoleClient();
  const target: OnboardingState = reason === "churned" ? "done_churned" : "done_paid";
  const now = new Date().toISOString();
  await sb
    .from("subscriptions")
    .update({
      onboarding_state: target,
      onboarding_state_entered_at: now,
      updated_at: now,
    })
    .eq("user_id", studentId);
  // Soft-cancel every still-live timer; failed/fired stay as they are.
  await sb
    .from("onboarding_timers")
    .update({ cancelled_at: now })
    .eq("student_id", studentId)
    .is("fired_at", null)
    .is("cancelled_at", null);
  await recordAudit({
    action: "onboarding.done",
    actorId: null,
    subjectType: "user",
    subjectId: studentId,
    meta: { reason, target },
  });
}
