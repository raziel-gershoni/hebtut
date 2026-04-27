import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday, commitUsage } from "@/server/quota";
import { fanOutToTeachers } from "@/server/notifications";

export async function handleStudentMedia(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from || !ctx.chat) return false;
  const voice = msg.voice;
  const note = msg.video_note;
  if (!voice && !note) return false;

  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, tz, tg_chat_id")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();

  if (!user) {
    // Self-register, then retry on the next inbound message.
    await sb.from("users").insert({
      tg_user_id: ctx.from.id,
      tg_chat_id: ctx.chat.id,
      name: ctx.from.first_name ?? ctx.from.username ?? `user ${ctx.from.id}`,
      role: "pending",
    });
    await ctx.reply(ru.greetingRegistered);
    return true;
  }

  if (user.tg_chat_id !== ctx.chat.id) {
    await sb.from("users").update({ tg_chat_id: ctx.chat.id }).eq("id", user.id);
  }

  const kind: "voice" | "video_note" = voice ? "voice" : "video_note";
  const fileId = (voice?.file_id ?? note?.file_id) as string;
  const fileUniqueId = (voice?.file_unique_id ?? note?.file_unique_id) ?? null;
  const duration = (voice?.duration ?? note?.duration ?? 0) as number;

  if (user.role === "pending") {
    await sb.from("messages").insert({
      student_id: user.id,
      direction: "in",
      kind,
      file_id: fileId,
      file_unique_id: fileUniqueId,
      duration,
      status: "orphaned",
      tg_message_id_in_student_chat: msg.message_id,
    });
    await ctx.reply(ru.pendingNotice);
    return true;
  }

  if (user.role !== "student") {
    // teacher/admin sending media outside of a reply — not our concern here.
    return false;
  }

  // Duration is read straight from the webhook payload — never download to measure.
  const remaining = await getRemainingForToday(user.id, user.tz);
  if (duration > remaining) {
    await ctx.reply(ru.overQuota(formatDuration(remaining)));
    return true;
  }

  // Make sure the student has at least one teacher; otherwise tell them.
  const { data: links } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", user.id);
  if (!links?.length) {
    await ctx.reply(ru.noTeachers);
    return true;
  }

  const { data: inserted, error } = await sb
    .from("messages")
    .insert({
      student_id: user.id,
      direction: "in",
      kind,
      file_id: fileId,
      file_unique_id: fileUniqueId,
      duration,
      status: "pending",
      tg_message_id_in_student_chat: msg.message_id,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await ctx.reply(ru.unknownInput);
    return true;
  }

  const newRemaining = await commitUsage(user.id, user.tz, duration);
  await ctx.reply(ru.acceptedStudent(formatDuration(newRemaining)));
  await fanOutToTeachers(inserted.id);
  return true;
}
