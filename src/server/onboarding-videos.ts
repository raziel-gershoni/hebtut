import type { InlineKeyboardButton } from "grammy/types";
import { InputFile } from "grammy";
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

  // Build the video_note source. The TG bot API has a hard restriction
  // here: sendVideoNote does NOT accept HTTP(S) URLs — only a cached
  // file_id (string) or bytes uploaded as multipart (InputFile). This is
  // different from sendVideo which accepts URLs. So when we don't have
  // a cached file_id yet, grammY's InputFile fetches the bytes from
  // Supabase on our server and forwards them to TG as multipart.
  let videoNoteArg: string | InputFile;
  if (row.tg_file_id) {
    videoNoteArg = row.tg_file_id;
  } else {
    const { data } = sb.storage.from(BUCKET).getPublicUrl(row.storage_path);
    if (!data.publicUrl) {
      console.warn("onboarding video public-url construction failed", {
        student_id: studentId,
        step,
      });
      return;
    }
    videoNoteArg = new InputFile(new URL(data.publicUrl));
  }

  try {
    // sendVideoNote — Telegram circular preview. Requires square source
    // (the admin upload pipeline center-crops to 384×384) and ≤60 s
    // (capped during compression). reply_markup still attaches below
    // the circle so the "Дальше" inline button continues to drive the
    // onboarding state machine.
    const sent = await getBot().api.sendVideoNote(u.tg_chat_id, videoNoteArg, {
      reply_markup,
    });
    // Cache the file_id on the first real send so subsequent sends to any
    // student are a single TG-internal reference. Re-uploaded slots (the
    // POST endpoint clears tg_file_id) re-capture here. Note: video_note
    // file_ids are NOT interchangeable with regular video file_ids — if
    // we ever switch send modes, the cached id must be invalidated.
    if (!row.tg_file_id && sent.video_note?.file_id) {
      await sb
        .from("onboarding_videos")
        .update({
          tg_file_id: sent.video_note.file_id,
          tg_file_unique_id: sent.video_note.file_unique_id ?? null,
        })
        .eq("step", step);
    }
    await recordAudit({
      action: `onboarding.${fallback.auditStep}`,
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { source: "video_note", step },
    });
  } catch (e) {
    // TG rejects non-square videos with "wrong file format" or similar.
    // Most likely cause: file uploaded BEFORE the video_note pipeline
    // landed, so the bytes in storage are regular landscape MP4. Don't
    // leave the student stuck with no message — fall back to the text
    // placeholder + button so they can at least continue. The admin sees
    // the underlying error via the audit log with source='video_note_failed'
    // and should re-upload through the new pipeline.
    console.warn("onboarding video_note send failed; falling back to text", {
      student_id: studentId,
      step,
      reason: (e as Error).message,
    });
    try {
      await getBot().api.sendMessage(u.tg_chat_id, fallback.text, { reply_markup });
      await recordAudit({
        action: `onboarding.${fallback.auditStep}`,
        actorId: null,
        subjectType: "user",
        subjectId: studentId,
        meta: {
          source: "video_note_failed",
          step,
          error: (e as Error).message,
        },
      });
    } catch (e2) {
      console.warn("onboarding text-fallback send also failed", {
        student_id: studentId,
        step,
        reason: (e2 as Error).message,
      });
    }
  }
}
