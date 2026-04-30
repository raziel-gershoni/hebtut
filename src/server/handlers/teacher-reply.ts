import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { ru } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "@/server/notifications";
import { isTgUserBanned } from "@/server/invites";
import { userHandle } from "@/lib/handle";

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
    await ctx.reply(ru.suspendedNotice);
    return true;
  }

  if (!replyTo) {
    await ctx.reply(ru.teacherReplyMissingContext);
    return true;
  }

  const { data: prompt } = await sb
    .from("prompts")
    .select("id, student_id, student_message_id, teacher_id, tg_prompt_message_id")
    .eq("teacher_id", teacher.id)
    .eq("tg_prompt_message_id", replyTo.message_id)
    .maybeSingle();
  if (!prompt) {
    await ctx.reply(ru.teacherReplyMissingContext);
    return true;
  }

  if (
    !matchesPrompt(
      { replyToMessageId: replyTo.message_id, teacherId: teacher.id },
      { tg_prompt_message_id: prompt.tg_prompt_message_id, teacher_id: prompt.teacher_id },
    )
  ) {
    await ctx.reply(ru.teacherReplyMissingContext);
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
      await ctx.reply(ru.teacherReplyFailed);
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
    await ctx.reply(ru.teacherReplyFailed);
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
      await ctx.reply(ru.teacherReplyFailed);
      return true;
    }
  }

  const { data: student } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", prompt.student_id)
    .single();
  if (!student) {
    await ctx.reply(ru.teacherReplyFailed);
    return true;
  }

  const bot = getBot();
  const kind: "voice" | "video_note" = voice ? "voice" : "video_note";
  const fileId = (voice?.file_id ?? note?.file_id) as string;
  const duration = (voice?.duration ?? note?.duration ?? 0) as number;

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
    await ctx.reply(ru.teacherReplyFailed);
    return true;
  }

  await sb.from("messages").insert({
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
  });

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
    await editAllNotificationsForMessage(original.id, ru.teacherNotificationTaken(teacherHandle));
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

  await ctx.reply(ru.teacherReplyDelivered);
  return true;
}
