import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { ru } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "@/server/notifications";
import { isTgUserBanned } from "@/server/invites";
import { userHandle } from "@/lib/handle";
import { recordAudit } from "@/server/audit";
import { nextWindowOpen } from "@/server/response-window";
import { formatInTimeZone } from "date-fns-tz";
import { addMinutes } from "date-fns";
import { advanceOnboarding, scheduleTimer } from "@/server/onboarding";
import { transcribeTgAudio } from "@/server/transcribe";
import { getTranscriptsEnabled, getTranslationEnabled } from "@/server/settings";

export interface ReplyContext {
  replyToMessageId: number;
  teacherId: number;
}
export interface PromptCandidate {
  tg_prompt_message_id: number;
  teacher_id: number;
}

export function matchesPrompt(reply: ReplyContext, prompt: PromptCandidate): boolean {
  return (
    prompt.tg_prompt_message_id === reply.replyToMessageId &&
    prompt.teacher_id === reply.teacherId
  );
}

export async function handleTeacherReply(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from) return false;
  const voice = msg.voice;
  const note = msg.video_note;
  if (!voice && !note) return false;

  if (await isTgUserBanned(ctx.from.id)) return true;

  const replyTo = msg.reply_to_message;

  const sb = getServiceRoleClient();
  const { data: teacher } = await sb
    .from("users")
    .select("id, role, tg_user_id, display_handle, status")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();
  if (!teacher || teacher.role !== "teacher") {
    return false; // not a teacher → not our route, fall through to student-message
  }
  if (teacher.status === "suspended") {
    await ctx.reply(ru.bot.access.suspendedNotice);
    return true;
  }

  if (!replyTo) {
    await ctx.reply(ru.bot.notifications.teacherReplyMissingContext);
    return true;
  }

  const { data: prompt } = await sb
    .from("prompts")
    .select("id, student_id, student_message_id, teacher_id, tg_prompt_message_id")
    .eq("teacher_id", teacher.id)
    .eq("tg_prompt_message_id", replyTo.message_id)
    .maybeSingle();
  if (!prompt) {
    await ctx.reply(ru.bot.notifications.teacherReplyMissingContext);
    return true;
  }

  if (
    !matchesPrompt(
      { replyToMessageId: replyTo.message_id, teacherId: teacher.id },
      { tg_prompt_message_id: prompt.tg_prompt_message_id, teacher_id: prompt.teacher_id },
    )
  ) {
    await ctx.reply(ru.bot.notifications.teacherReplyMissingContext);
    return true;
  }

  // Initiation prompts have no original message; reply prompts do. Load the
  // original lazily so the rest of the handler can branch on `original`.
  let original: {
    id: number;
    student_id: number;
    status: string;
    direction: string;
    tg_message_id_in_student_chat: number | null;
  } | null = null;
  if (prompt.student_message_id != null) {
    const { data: orig } = await sb
      .from("messages")
      .select("id, student_id, status, direction, tg_message_id_in_student_chat")
      .eq("id", prompt.student_message_id)
      .single();
    if (!orig || orig.direction !== "in" || orig.status === "orphaned") {
      await ctx.reply(ru.bot.notifications.teacherReplyFailed);
      return true;
    }
    original = orig;
  }

  // Ensure the (S, T) link still holds.
  const { data: link } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", prompt.student_id)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  if (!link) {
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  // For pending/expired student messages we require an active claim by this
  // teacher. Already-answered originals (followup) and pure initiations skip
  // the live-claim check.
  if (original && original.status !== "answered") {
    const { data: claim } = await sb
      .from("claims")
      .select("teacher_id, expires_at")
      .eq("student_id", prompt.student_id)
      .maybeSingle();
    const claimActive =
      !!claim && new Date(claim.expires_at).getTime() > Date.now() && claim.teacher_id === teacher.id;
    if (!claimActive) {
      await ctx.reply(ru.bot.notifications.teacherReplyFailed);
      return true;
    }
  }

  const { data: student } = await sb
    .from("users")
    .select("tg_chat_id, tg_user_id, display_handle")
    .eq("id", prompt.student_id)
    .single();
  if (!student) {
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  const bot = getBot();
  const kind: "voice" | "video_note" = voice ? "voice" : "video_note";
  const fileId = (voice?.file_id ?? note?.file_id) as string;
  const duration = (voice?.duration ?? note?.duration ?? 0) as number;

  // Response-window gate. Replies to a student-initiated thread (`original`
  // is set) deliver immediately — the conversational expectation is "now."
  // Pure initiation (`original === null`) is held until the student's
  // response window opens, if they've configured one.
  if (!original) {
    const { data: sub } = await sb
      .from("subscriptions")
      .select("response_window_start, response_window_end, response_window_tz")
      .eq("user_id", prompt.student_id)
      .maybeSingle();
    const nextOpen = sub
      ? nextWindowOpen(
          new Date(),
          sub.response_window_start,
          sub.response_window_end,
          sub.response_window_tz,
        )
      : null;
    if (nextOpen) {
      await sb.from("scheduled_outbound").insert({
        student_id: prompt.student_id,
        teacher_id: teacher.id,
        kind,
        file_id: fileId,
        duration,
        original_message_id: null,
        tg_chat_id: student.tg_chat_id,
        deliver_at: nextOpen.toISOString(),
      });
      await recordAudit({
        action: "message.scheduled",
        actorId: teacher.id,
        subjectType: "user",
        subjectId: prompt.student_id,
        meta: { kind, duration, deliver_at: nextOpen.toISOString() },
      });
      const localTime = formatInTimeZone(
        nextOpen,
        sub?.response_window_tz ?? "Asia/Jerusalem",
        "HH:mm",
      );
      await ctx.reply(ru.bot.notifications.teacherReplyScheduled(localTime));
      return true;
    }
  }

  // TG-reply to the student's original message when one exists. Initiation
  // prompts have no original — the message lands as a fresh top-level note.
  // allow_sending_without_reply: if the student deleted the original, the
  // bot still delivers (just un-threaded). If the whole chat is gone, the
  // catch below handles it.
  const replyParams =
    original?.tg_message_id_in_student_chat != null
      ? {
          reply_parameters: {
            message_id: original.tg_message_id_in_student_chat,
            allow_sending_without_reply: true,
          },
        }
      : {};

  let newFileId = fileId;
  let newFileUniqueId: string | null = null;
  let sentMessageId: number;
  try {
    if (kind === "voice") {
      const sent = await bot.api.sendVoice(student.tg_chat_id, fileId, replyParams);
      newFileId = sent.voice?.file_id ?? fileId;
      newFileUniqueId = sent.voice?.file_unique_id ?? null;
      sentMessageId = sent.message_id;
    } else {
      const sent = await bot.api.sendVideoNote(student.tg_chat_id, fileId, replyParams);
      newFileId = sent.video_note?.file_id ?? fileId;
      newFileUniqueId = sent.video_note?.file_unique_id ?? null;
      sentMessageId = sent.message_id;
    }
  } catch (e) {
    console.error("relay to student failed", e);
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  const { data: outRow } = await sb
    .from("messages")
    .insert({
      student_id: prompt.student_id,
      direction: "out",
      teacher_id: teacher.id,
      kind,
      file_id: newFileId,
      file_unique_id: newFileUniqueId,
      duration,
      status: "answered",
      reply_to_id: original?.id ?? null,
      tg_message_id_in_student_chat: sentMessageId,
    })
    .select("id")
    .single();

  await recordAudit({
    action: "message.out",
    actorId: teacher.id,
    subjectType: "message",
    subjectId: outRow?.id ?? null,
    meta: {
      kind,
      duration,
      student_id: prompt.student_id,
      reply_to_id: original?.id ?? null,
    },
  });

  // Onboarding Step 8: 5 minutes after the FIRST teacher reply lands, the
  // bot DMs a brief meta-explainer ("вот так это и работает…"). Detect by
  // checking whether the student has any earlier outbound row — if not,
  // this one is the first.
  const { data: subRow } = await sb
    .from("subscriptions")
    .select("onboarding_state, onboarding_first_reply_at")
    .eq("user_id", prompt.student_id)
    .maybeSingle();
  if (
    subRow &&
    subRow.onboarding_first_reply_at == null &&
    (subRow.onboarding_state === "awaiting_first_reply" ||
      subRow.onboarding_state === "cta_record")
  ) {
    const nowIso = new Date().toISOString();
    await sb
      .from("subscriptions")
      .update({ onboarding_first_reply_at: nowIso, updated_at: nowIso })
      .eq("user_id", prompt.student_id);
    await advanceOnboarding(prompt.student_id, "meta_explainer_pending");
    await scheduleTimer(
      prompt.student_id,
      "meta_explainer",
      addMinutes(new Date(), 5),
    );
  }

  // "First answer" + notification edits only apply when there's an original
  // student message in flight. Initiation has nothing to mark answered.
  if (original && original.status !== "answered") {
    await sb
      .from("messages")
      .update({
        status: "answered",
        answered_at: new Date().toISOString(),
        claimed_by_teacher_id: teacher.id,
      })
      .eq("id", original.id);
    const teacherHandle = teacher.display_handle ?? userHandle(teacher.tg_user_id).handle;
    const studentHandle = student.display_handle ?? userHandle(student.tg_user_id).handle;
    await editAllNotificationsForMessage(
      original.id,
      ru.bot.notifications.teacherNotificationTaken(teacherHandle, studentHandle),
    );
  }

  // Refresh the (S, T) session — the teacher is engaged.
  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await sb
    .from("claims")
    .upsert(
      {
        student_id: prompt.student_id,
        teacher_id: teacher.id,
        claimed_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "student_id" },
    );
  await recordAudit({
    action: "claim.refresh",
    actorId: teacher.id,
    subjectType: "claim",
    subjectId: prompt.student_id,
    meta: { kind: "reply-tail", expires_at: expiresAt },
  });

  // Auto-transcript: deferred until just before the teacher-side ack so
  // the ack can echo the transcript back to the teacher with an inline
  // edit-link (web_app deep-link → Mini App opens with the dialog ready).
  // Best-effort: audio is already in the student's chat by now. Gated by
  // the admin `transcripts_enabled` toggle and the GEMINI_API_KEY env;
  // either off → returns null and we fall back to the plain ack.
  const transcriptText =
    outRow?.id != null
      ? await transcribeAndDeliverFor(
          outRow.id,
          prompt.student_id,
          student.tg_chat_id,
          sentMessageId,
          newFileId,
          kind,
        )
      : null;

  if (transcriptText && outRow?.id != null) {
    const editUrl = `${serverEnv.APP_BASE_URL.replace(/\/$/, "")}/students/${prompt.student_id}?edit_transcript=${outRow.id}`;
    await ctx.reply(
      ru.bot.notifications.teacherReplyDeliveredWithTranscript(transcriptText),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ru.bot.notifications.editTranscriptButton,
                web_app: { url: editUrl },
              },
            ],
          ],
        },
      },
    );
  } else {
    await ctx.reply(ru.bot.notifications.teacherReplyDelivered);
  }
  return true;
}

/**
 * Teacher swipe-replies a prompt with TEXT instead of a voice/video. Same
 * resolution + access-check shape as `handleTeacherReply` (intentional code
 * twin — the divergence is small and mostly mechanical: sendMessage instead
 * of sendVoice, kind='text' with text_content instead of file_id, no
 * response-window queueing).
 *
 * Returns false when the input doesn't meet teacher-reply criteria (not a
 * text message, no swipe-reply, sender isn't a teacher, etc.) — the caller
 * in /api/webhook falls through to handleUnknown so a plain student typing
 * a question still gets the legacy "I only understand voice" reply.
 *
 * Returns true when handled (delivered, errored gracefully, or rejected
 * with explicit user-facing copy) — caller stops there.
 */
export async function handleTeacherReplyText(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from || !msg.text) return false;
  // Slash commands are handled separately. Ignore them here so /start &c.
  // don't try to swipe-reply-resolve.
  if (msg.text.startsWith("/")) return false;
  const replyTo = msg.reply_to_message;
  if (!replyTo) return false;

  if (await isTgUserBanned(ctx.from.id)) return true;

  const sb = getServiceRoleClient();
  const { data: teacher } = await sb
    .from("users")
    .select("id, role, tg_user_id, display_handle, status")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();
  if (!teacher || teacher.role !== "teacher") return false;
  if (teacher.status === "suspended") {
    await ctx.reply(ru.bot.access.suspendedNotice);
    return true;
  }

  const { data: prompt } = await sb
    .from("prompts")
    .select("id, student_id, student_message_id, teacher_id, tg_prompt_message_id")
    .eq("teacher_id", teacher.id)
    .eq("tg_prompt_message_id", replyTo.message_id)
    .maybeSingle();
  if (!prompt) {
    // Replied to a message that isn't a known prompt for this teacher.
    // Could be an old/expired prompt, or a totally unrelated message.
    // Return false so handleUnknown takes over with the generic copy.
    return false;
  }

  // Resolve original (when this is a reply-prompt, not an initiation).
  let original: {
    id: number;
    student_id: number;
    status: string;
    direction: string;
    tg_message_id_in_student_chat: number | null;
  } | null = null;
  if (prompt.student_message_id != null) {
    const { data: orig } = await sb
      .from("messages")
      .select("id, student_id, status, direction, tg_message_id_in_student_chat")
      .eq("id", prompt.student_message_id)
      .single();
    if (!orig || orig.direction !== "in" || orig.status === "orphaned") {
      await ctx.reply(ru.bot.notifications.teacherReplyFailed);
      return true;
    }
    original = orig;
  }

  // (S, T) link still active.
  const { data: link } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", prompt.student_id)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  if (!link) {
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  // For pending/expired student messages we require an active claim by this
  // teacher. Already-answered originals (followup) and pure initiations skip.
  if (original && original.status !== "answered") {
    const { data: claim } = await sb
      .from("claims")
      .select("teacher_id, expires_at")
      .eq("student_id", prompt.student_id)
      .maybeSingle();
    const claimActive =
      !!claim && new Date(claim.expires_at).getTime() > Date.now() && claim.teacher_id === teacher.id;
    if (!claimActive) {
      await ctx.reply(ru.bot.notifications.teacherReplyFailed);
      return true;
    }
  }

  const { data: student } = await sb
    .from("users")
    .select("tg_chat_id, tg_user_id, display_handle")
    .eq("id", prompt.student_id)
    .single();
  if (!student) {
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  // Send the text. TG-reply to the student's original when one exists; else
  // freestanding (initiation). allow_sending_without_reply mirrors the
  // voice path so a deleted original still delivers un-threaded.
  const replyParams =
    original?.tg_message_id_in_student_chat != null
      ? {
          reply_parameters: {
            message_id: original.tg_message_id_in_student_chat,
            allow_sending_without_reply: true,
          },
        }
      : {};

  const bot = getBot();
  let sentMessageId: number;
  try {
    const sent = await bot.api.sendMessage(student.tg_chat_id, msg.text, replyParams);
    sentMessageId = sent.message_id;
  } catch (e) {
    console.error("relay text to student failed", e);
    await ctx.reply(ru.bot.notifications.teacherReplyFailed);
    return true;
  }

  // Insert messages row. file_id is null for text; text_content holds the
  // payload. duration is 0 — meaningless for text, but the column is
  // NOT NULL with a CHECK ≥ 0, so 0 is the right placeholder.
  const { data: outRow } = await sb
    .from("messages")
    .insert({
      student_id: prompt.student_id,
      direction: "out",
      teacher_id: teacher.id,
      kind: "text",
      file_id: null,
      file_unique_id: null,
      text_content: msg.text,
      duration: 0,
      status: "answered",
      reply_to_id: original?.id ?? null,
      tg_message_id_in_student_chat: sentMessageId,
    })
    .select("id")
    .single();

  await recordAudit({
    action: "message.out",
    actorId: teacher.id,
    subjectType: "message",
    subjectId: outRow?.id ?? null,
    meta: {
      kind: "text",
      duration: 0,
      student_id: prompt.student_id,
      reply_to_id: original?.id ?? null,
    },
  });

  // First answer + notification edits (only when there's an original in flight).
  if (original && original.status !== "answered") {
    await sb
      .from("messages")
      .update({
        status: "answered",
        answered_at: new Date().toISOString(),
        claimed_by_teacher_id: teacher.id,
      })
      .eq("id", original.id);
    const teacherHandle = teacher.display_handle ?? userHandle(teacher.tg_user_id).handle;
    const studentHandle = student.display_handle ?? userHandle(student.tg_user_id).handle;
    await editAllNotificationsForMessage(
      original.id,
      ru.bot.notifications.teacherNotificationTaken(teacherHandle, studentHandle),
    );
  }

  // Refresh the (S, T) session.
  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await sb.from("claims").upsert(
    {
      student_id: prompt.student_id,
      teacher_id: teacher.id,
      claimed_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "student_id" },
  );
  await recordAudit({
    action: "claim.refresh",
    actorId: teacher.id,
    subjectType: "claim",
    subjectId: prompt.student_id,
    meta: { kind: "text-reply-tail", expires_at: expiresAt },
  });

  await ctx.reply(ru.bot.notifications.teacherReplyDelivered);
  return true;
}

/**
 * Best-effort transcription + delivery of the follow-up text message to
 * the student. Audio bubble is already in the student's chat by the time
 * this runs; whatever happens here is graceful-degrade. The teacher-side
 * ack composer consumes the returned text to echo it back with an edit
 * affordance.
 *
 * Returns:
 *  - the transcript string on success (also persisted + delivered to the student),
 *  - null when the admin toggle is off, the env key is missing, Gemini
 *    failed/timed out, or anything threw.
 *
 * Behaviour by outcome:
 *  - Toggle off: skip entirely. No transcript, no failure notice, no
 *    Gemini call (cheap path).
 *  - Success: persist {transcript_text, transcript_tg_message_id} and DM
 *    the student threaded as a reply to the audio.
 *  - Gemini hiccup: DM the student a short "could not transcribe" notice
 *    (also threaded) so the absence doesn't read like bot brokenness.
 *  - Post-deliver throw: swallow with a warn — the student has the audio.
 */
async function transcribeAndDeliverFor(
  messageId: number,
  studentId: number,
  studentChatId: number,
  audioTgMessageId: number | null,
  fileId: string,
  kind: "voice" | "video_note",
): Promise<string | null> {
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
    const result = await transcribeTgAudio(fileId, kind, {
      translate: wantTranslate,
    });
    if (result) {
      const { transcript, translation } = result;
      const sent = await getBot().api.sendMessage(studentChatId, transcript, replyParams);

      let translationTgMessageId: number | null = null;
      if (wantTranslate && translation) {
        try {
          const sentTr = await getBot().api.sendMessage(
            studentChatId,
            `${ru.bot.transcripts.translationPrefix}${translation}`,
            replyParams,
          );
          translationTgMessageId = sentTr.message_id;
        } catch (e) {
          console.warn(
            "[transcribe] translation send failed",
            (e as Error).message,
          );
        }
      }

      await sb
        .from("messages")
        .update({
          transcript_text: transcript,
          transcript_tg_message_id: sent.message_id,
          translation_text: translation && translationTgMessageId != null ? translation : null,
          translation_tg_message_id: translationTgMessageId,
        })
        .eq("id", messageId);
      return transcript;
    }
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
    return null;
  }
}
