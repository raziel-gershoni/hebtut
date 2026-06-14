import type { InlineKeyboardButton } from "grammy/types";
import { InputFile } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { recordAudit } from "@/server/audit";
import { ru } from "@/lib/i18n";
import { serverEnv } from "@/lib/env";
import { signedLibraryMediaUrl } from "@/server/media-storage";
import { scheduleTimer } from "@/server/onboarding";
import type {
  OnboardingState,
  OnboardingVideoStep,
} from "@/types/database";

export interface OnboardingFallback {
  text: string;
  buttons?: InlineKeyboardButton[][];
  /** Audit suffix — `onboarding.<auditStep>`. */
  auditStep: string;
}

const feedbackUrl = (): string =>
  `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=feedback`;

/**
 * Shared copy + buttons for each video step. Both the in-process caller
 * (`sendStepNVideoN` in src/server/onboarding.ts) and the drip dispatcher
 * (`/api/cron/onboarding`) use this so the Continue button on the last
 * clip matches what would have been on a single-clip slot today.
 */
export function fallbackForStep(step: OnboardingVideoStep): OnboardingFallback {
  switch (step) {
    case "video1":
      return {
        text: ru.bot.onboarding.video1Placeholder,
        buttons: [[{ text: ru.bot.onboarding.step2Button, callback_data: "onb:continue" }]],
        auditStep: "step2_video1",
      };
    case "video2":
      return {
        text: ru.bot.onboarding.video2Placeholder,
        buttons: [[{ text: ru.bot.onboarding.step3Button, callback_data: "onb:next" }]],
        auditStep: "step3_video2",
      };
    case "video3":
      return {
        text: ru.bot.onboarding.video3Placeholder,
        buttons: [[{ text: ru.bot.onboarding.video3Button, url: feedbackUrl() }]],
        auditStep: "step12_3_video3",
      };
  }
}

/**
 * Returns true if a queued sequence clip for `step` is still relevant to a
 * student currently in `state`. Drives the dispatcher's stale-check: if the
 * student has moved past this step (or onboarding got reset), the queued
 * clip is silently dropped instead of arriving out of context.
 *
 * video3 fires from two distinct callback-path states:
 *   - survey_no → `sendStep12_3Video3` is called and the student is
 *     immediately marked `done_churned`. By the time the cron picks up a
 *     follow-up clip the state is already terminal — accept it anyway so
 *     the sequence finishes.
 *   - survey_later → `churn_followup` timer fires from `survey_later` and
 *     calls `sendStep12_3Video3`, again immediately marking done_churned.
 *     Same acceptance rule applies.
 */
export function isStateMatchingStep(
  state: OnboardingState,
  step: OnboardingVideoStep,
): boolean {
  switch (step) {
    case "video1":
      return state === "video1";
    case "video2":
      return state === "video2";
    case "video3":
      // Accept the transient + terminal states the video3 send sits between.
      return (
        state === "survey_no" ||
        state === "survey_later" ||
        state === "done_churned"
      );
  }
}

interface ClipRow {
  id: number;
  position: number;
  storage_path: string;
  tg_file_id: string | null;
  tg_file_unique_id: string | null;
}

/**
 * Sends the first clip of an onboarding video step. Three branches:
 *   - **0 rows** for the step → text fallback + buttons (same as today's
 *     pre-upload placeholder behaviour).
 *   - **1 row** → that clip with `fallback.buttons` attached. Same UX as
 *     before sequences existed; no timer scheduled.
 *   - **N > 1 rows** → first clip with NO inline keyboard, then a
 *     `video_sequence_next` timer for `due_at = now` so the next cron tick
 *     (≤60s away) drips the next clip. Each follow-up clip carries no
 *     keyboard either, except the LAST one which gets `fallback.buttons`
 *     so the student can advance the state machine.
 *
 * Audited as `onboarding.<auditStep>` with `meta.source` = `'video_note'`
 * on success, `'placeholder'` when text-fallback fired, or
 * `'video_note_failed'` when the send threw and we surfaced a fallback.
 */
export async function sendOnboardingVideoSequence(
  studentId: number,
  step: OnboardingVideoStep,
  fallback: OnboardingFallback,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: u } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!u?.tg_chat_id) return;

  const { data: rows } = await sb
    .from("onboarding_videos")
    .select("id, position, storage_path, tg_file_id, tg_file_unique_id")
    .eq("step", step)
    .order("position", { ascending: true });

  if (!rows || rows.length === 0) {
    await sendFallbackText(u.tg_chat_id, studentId, step, fallback, "placeholder");
    return;
  }

  const isOnlyClip = rows.length === 1;
  const sent = await sendOneClip({
    studentId,
    chatId: u.tg_chat_id,
    step,
    row: rows[0] as ClipRow,
    reply_markup: isOnlyClip && fallback.buttons
      ? { inline_keyboard: fallback.buttons }
      : undefined,
  });

  // If this is the only clip and the send failed, surface the text+button
  // fallback so the student always has a way to advance.
  if (!sent && isOnlyClip) {
    await sendFallbackText(u.tg_chat_id, studentId, step, fallback, "video_note_failed");
  }

  if (!isOnlyClip) {
    await scheduleTimer(
      studentId,
      "video_sequence_next",
      new Date(),
      { step, next_position: 2 },
    );
  }
}

/**
 * Sends one clip. Returns `true` on success, `false` on permanent send
 * failure (so callers can decide whether to surface a text fallback — only
 * the LAST clip in a sequence needs to, because intermediate failures still
 * let the cron try the next clip).
 *
 * Behaviour matches the original single-clip helper: cached `tg_file_id`
 * is used when present; otherwise `InputFile` fetches bytes from a presigned
 * R2 GET URL and forwards them as multipart (TG `sendVideoNote` doesn't take
 * URLs). TG fetches synchronously, well within the 6h presign TTL. On success
 * the captured `file_id` is persisted back to the row for subsequent students.
 */
export async function sendOneClip(args: {
  studentId: number;
  chatId: number;
  step: OnboardingVideoStep;
  row: ClipRow;
  reply_markup: { inline_keyboard: InlineKeyboardButton[][] } | undefined;
}): Promise<boolean> {
  const { studentId, chatId, step, row, reply_markup } = args;
  const sb = getServiceRoleClient();
  const fallback = fallbackForStep(step);

  let videoNoteArg: string | InputFile;
  if (row.tg_file_id) {
    videoNoteArg = row.tg_file_id;
  } else {
    // Assumes the object is in R2 (Phase A backfill complete; new uploads insert
    // r2_migrated=true). A stray un-migrated clip would presign fine but TG's
    // fetch would 404 → caught below → text fallback for the student (no hard
    // break, no tg_file_id cached so it retries next time).
    let signedUrl: string;
    try {
      signedUrl = await signedLibraryMediaUrl(row.storage_path);
    } catch (e) {
      console.warn("onboarding video presigned-url construction failed", {
        student_id: studentId,
        step,
        position: row.position,
        reason: (e as Error).message,
      });
      return false;
    }
    videoNoteArg = new InputFile(new URL(signedUrl));
  }

  try {
    const sent = await getBot().api.sendVideoNote(chatId, videoNoteArg, {
      reply_markup,
    });
    if (!row.tg_file_id && sent.video_note?.file_id) {
      await sb
        .from("onboarding_videos")
        .update({
          tg_file_id: sent.video_note.file_id,
          tg_file_unique_id: sent.video_note.file_unique_id ?? null,
        })
        .eq("id", row.id);
    }
    await recordAudit({
      action: `onboarding.${fallback.auditStep}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { source: "video_note", step, position: row.position },
    });
    return true;
  } catch (e) {
    console.warn("onboarding video_note send failed", {
      student_id: studentId,
      step,
      position: row.position,
      reason: (e as Error).message,
    });
    await recordAudit({
      action: `onboarding.${fallback.auditStep}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: {
        source: "video_note_failed",
        step,
        position: row.position,
        error: (e as Error).message,
      },
    });
    return false;
  }
}

async function sendFallbackText(
  chatId: number,
  studentId: number,
  step: OnboardingVideoStep,
  fallback: OnboardingFallback,
  source: "placeholder" | "video_note_failed",
): Promise<void> {
  const reply_markup = fallback.buttons
    ? { inline_keyboard: fallback.buttons }
    : undefined;
  try {
    await getBot().api.sendMessage(chatId, fallback.text, { reply_markup });
    await recordAudit({
      action: `onboarding.${fallback.auditStep}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { source, step },
    });
  } catch (e) {
    console.warn("onboarding text fallback send failed", {
      student_id: studentId,
      step,
      source,
      reason: (e as Error).message,
    });
  }
}

