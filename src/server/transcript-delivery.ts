import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";
import {
  transcribeTgAudio,
  translateToRussian,
  isMostlyRussian,
} from "@/server/transcribe";
import { getTranscriptsEnabled, getTranslationEnabled } from "@/server/settings";

export interface TranscribeResult {
  transcript: string;
  translation: string | null;
}

export interface TranscriptDeliveryInput {
  /** messages.id of the just-delivered outbound audio. */
  messageId: number;
  studentId: number;
  /** Tutor who recorded the audio — audit attribution only. */
  teacherId: number | null;
  studentChatId: number;
  /** TG message id of the audio in the student's chat (threading target). */
  audioTgMessageId: number | null;
  fileId: string;
  kind: "voice" | "video_note";
}

/**
 * Best-effort transcription + delivery of the follow-up text message to
 * the student. Audio bubble is already in the student's chat by the time
 * this runs; whatever happens here is graceful-degrade. Shared by the
 * immediate webhook path (teacher-reply) and the scheduled-delivery cron.
 * The teacher-side ack composer consumes the returned text to echo it
 * back with an edit affordance (immediate path only).
 *
 * Returns:
 *  - the transcript string on success (also persisted + delivered to the student),
 *  - null when the admin toggle is off, the env key is missing, Gemini
 *    failed/timed out, or anything threw.
 *
 * Behaviour by outcome:
 *  - Toggle off (global or per-user): skip entirely. No transcript, no
 *    failure notice, no Gemini call (cheap path). Deliberate state — the
 *    toggle flips themselves are audited, so no per-message journal spam.
 *  - Success: persist {transcript_text, transcript_tg_message_id} and DM
 *    the student threaded as a reply to the audio.
 *  - Gemini hiccup: DM the student a short "could not transcribe" notice
 *    (also threaded) so the absence doesn't read like bot brokenness.
 *  - Post-deliver throw: swallow with a warn — the student has the audio.
 *
 * Failures (NOT deliberate skips) additionally land in the audit journal
 * as `transcript.failed` / `translation.failed` — console.warn dies with
 * Vercel's log retention, which made the prod incident undiagnosable.
 */
export async function transcribeAndDeliverFor(
  input: TranscriptDeliveryInput,
): Promise<TranscribeResult | null> {
  const {
    messageId,
    studentId,
    teacherId,
    studentChatId,
    audioTgMessageId,
    fileId,
    kind,
  } = input;
  if (!(await getTranscriptsEnabled())) return null;

  // Per-user opt-out (defaults are ON in the migration). Reading the row
  // here keeps the hot path one extra round-trip; acceptable for the
  // legibility win — no need to thread the toggle through the whole
  // call chain.
  const sb = getServiceRoleClient();
  const { data: subPrefs } = await sb
    .from("subscriptions")
    .select("transcripts_enabled, translation_enabled")
    .eq("user_id", studentId)
    .maybeSingle();
  if (subPrefs && !subPrefs.transcripts_enabled) return null;

  const wantTranslate =
    (subPrefs?.translation_enabled ?? true) && (await getTranslationEnabled());

  const replyParams =
    audioTgMessageId != null
      ? {
          reply_parameters: {
            message_id: audioTgMessageId,
            allow_sending_without_reply: true,
          },
        }
      : {};
  try {
    const transcript = await transcribeTgAudio(fileId, kind);
    if (transcript) {
      // Translate as a separate text-only Gemini call so the audio prompt
      // can't bleed Russian tokens into the Hebrew transcript. Skip when
      // the source itself is already mostly Russian — no point echoing.
      // Run translation BEFORE the send so transcript + translation land
      // as a single TG message (blank line between, no labels).
      let translation: string | null = null;
      if (wantTranslate && !isMostlyRussian(transcript)) {
        translation = await translateToRussian(transcript);
        if (!translation) {
          await recordAudit({
            action: "translation.failed",
            actorId: teacherId,
            subjectType: "message",
            subjectId: messageId,
            meta: { student_id: studentId, kind },
          });
        }
      }

      const body = translation ? `${transcript}\n\n${translation}` : transcript;
      // Wrap the whole bubble in a TG spoiler entity so it renders blurred
      // in the student's chat. Tap reveals — privacy win for public listening,
      // and fluent students who don't need the text aren't visually spammed.
      // The failure-notice path below stays in-the-clear (status string,
      // not content; blurring would be a usability foot-gun).
      const sent = await getBot().api.sendMessage(studentChatId, body, {
        ...replyParams,
        entities: [{ type: "spoiler", offset: 0, length: body.length }],
      });

      // Both message_id columns point at the same TG message — edits to
      // either field rebuild the combined body and editMessageText this
      // shared id. Keeping the column pair lets the edit endpoints stay
      // single-purpose without checking "did we send one or two".
      await sb
        .from("messages")
        .update({
          transcript_text: transcript,
          transcript_tg_message_id: sent.message_id,
          translation_text: translation,
          translation_tg_message_id: translation ? sent.message_id : null,
        })
        .eq("id", messageId);
      return { transcript, translation };
    }
    await recordAudit({
      action: "transcript.failed",
      actorId: teacherId,
      subjectType: "message",
      subjectId: messageId,
      meta: { student_id: studentId, kind, stage: "transcribe" },
    });
    await getBot()
      .api.sendMessage(
        studentChatId,
        ru.bot.transcripts.failureNotice,
        replyParams,
      )
      .catch((e) =>
        console.warn(
          "[transcribe] failure-notice send failed",
          (e as Error).message,
        ),
      );
    return null;
  } catch (e) {
    console.warn(
      "[transcribe] post-deliver failed",
      (e as Error).message,
    );
    await recordAudit({
      action: "transcript.failed",
      actorId: teacherId,
      subjectType: "message",
      subjectId: messageId,
      meta: {
        student_id: studentId,
        kind,
        stage: "exception",
        error: (e as Error).message,
      },
    });
    return null;
  }
}
