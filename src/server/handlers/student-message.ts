import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getUsedForToday, decideQuota, commitUsageSplit } from "@/server/quota";
import { serverEnv } from "@/lib/env";
import { fanOutToTeachers } from "@/server/notifications";
import { isTgUserBanned } from "@/server/invites";

export async function handleStudentMedia(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from || !ctx.chat) return false;
  const voice = msg.voice;
  const note = msg.video_note;
  if (!voice && !note) return false;

  if (await isTgUserBanned(ctx.from.id)) return true;

  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, status, tz, tg_chat_id")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();

  if (!user) {
    // Self-register as student (the new default) and retry on the next inbound.
    await sb.from("users").insert({
      tg_user_id: ctx.from.id,
      tg_chat_id: ctx.chat.id,
      name: ctx.from.first_name ?? ctx.from.username ?? `user ${ctx.from.id}`,
      role: "student",
    });
    await ctx.reply(ru.greetingStudentNew);
    return true;
  }

  if (user.status === "suspended") {
    await ctx.reply(ru.suspendedNotice);
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
    // Legacy row pre-rework. Treat as orphaned, same as before.
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
  const usedToday = await getUsedForToday(user.id, user.tz);
  const decision = decideQuota({
    usedToday,
    dailyQuota: serverEnv.DAILY_QUOTA_SECONDS,
    graceSeconds: serverEnv.OVERFLOW_GRACE_SECONDS,
    messageDuration: duration,
  });
  if (!decision.ok) {
    await ctx.reply(
      decision.remainingIncludingGrace > 0
        ? ru.overQuota(formatDuration(decision.remainingIncludingGrace))
        : ru.overQuotaExhausted,
    );
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

  await commitUsageSplit(user.id, user.tz, decision.todayDebit, decision.tomorrowDebit);

  // Choose the reply: overflow > low-warning > normal. Each takes priority
  // because the more urgent state should not be hidden by the cheerier copy.
  let reply: string;
  if (decision.tomorrowDebit > 0) {
    reply = ru.acceptedStudentOverflow(formatDuration(decision.tomorrowDebit));
  } else if (decision.newRemainingToday > 0 && decision.newRemainingToday <= 60) {
    reply = ru.acceptedStudentLow(formatDuration(decision.newRemainingToday));
  } else {
    reply = ru.acceptedStudent(formatDuration(decision.newRemainingToday));
  }
  await ctx.reply(reply);
  await fanOutToTeachers(inserted.id);
  return true;
}
