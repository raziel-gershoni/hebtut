import type { InlineKeyboardButton } from "grammy/types";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { recordAudit } from "@/server/audit";
import type { OnboardingVideoStep } from "@/types/database";

const BUCKET = "media-library";

export interface OnboardingFallback {
  text: string;
  buttons?: InlineKeyboardButton[][];
  /** Audit suffix — `onboarding.<auditStep>`. */
  auditStep: string;
}

/**
 * Sends the onboarding video for `step` to a student, with the inline
 * `fallback.buttons` attached. If no video is uploaded for the slot yet,
 * sends the `fallback.text` instead so onboarding never breaks before
 * admins upload the real clips.
 *
 * First send to TG of a freshly-uploaded slot pulls a 5-minute signed URL
 * from Supabase Storage and lets TG fetch the bytes. We capture the
 * resulting `file_id` and persist it back to the row — every subsequent
 * send is a single TG-internal reference (no Storage round-trip, no
 * re-upload). Same trick as `src/server/handlers/media-relay.ts`.
 *
 * Audited as `onboarding.<auditStep>` with `meta.source = 'video'` when
 * the real video flowed, `'placeholder'` when the text fallback fired.
 * Fail-soft on TG errors (mirrors `sendOnboardingMessage` at
 * `src/server/onboarding.ts:164-169`) — a TG hiccup must not poison a
 * state transition or a cron tick.
 */
export async function sendOnboardingVideoOrFallback(
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

  const reply_markup = fallback.buttons
    ? { inline_keyboard: fallback.buttons }
    : undefined;

  const { data: row } = await sb
    .from("onboarding_videos")
    .select("storage_path, tg_file_id, tg_file_unique_id")
    .eq("step", step)
    .maybeSingle();

  // No upload yet → today's text placeholder.
  if (!row) {
    try {
      await getBot().api.sendMessage(u.tg_chat_id, fallback.text, { reply_markup });
      await recordAudit({
        action: `onboarding.${fallback.auditStep}`,
        actorId: null,
        subjectType: "user",
        subjectId: studentId,
        meta: { source: "placeholder", step },
      });
    } catch (e) {
      console.warn("onboarding video fallback send failed", {
        student_id: studentId,
        step,
        reason: (e as Error).message,
      });
    }
    return;
  }

  let sendArg: string;
  if (row.tg_file_id) {
    sendArg = row.tg_file_id;
  } else {
    const { data: signed, error } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 300);
    if (error || !signed?.signedUrl) {
      console.warn("onboarding video sign-url failed", {
        student_id: studentId,
        step,
        reason: error?.message ?? "no url",
      });
      return;
    }
    sendArg = signed.signedUrl;
  }

  try {
    const sent = await getBot().api.sendVideo(u.tg_chat_id, sendArg, { reply_markup });
    // Cache the file_id on the first real send so subsequent sends to any
    // student are a single TG-internal reference. Re-uploaded slots (the
    // POST endpoint clears tg_file_id) re-capture here.
    if (!row.tg_file_id && sent.video?.file_id) {
      await sb
        .from("onboarding_videos")
        .update({
          tg_file_id: sent.video.file_id,
          tg_file_unique_id: sent.video.file_unique_id ?? null,
        })
        .eq("step", step);
    }
    await recordAudit({
      action: `onboarding.${fallback.auditStep}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { source: "video", step },
    });
  } catch (e) {
    console.warn("onboarding video send failed", {
      student_id: studentId,
      step,
      reason: (e as Error).message,
    });
  }
}
