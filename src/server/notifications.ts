import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";

/**
 * Notify every teacher linked to the student about a new inbound message.
 * If a teacher already holds an active claim on this student, OTHER linked
 * teachers see the "✓ T handling" state immediately so they don't try to
 * claim. The holder gets the actionable copy.
 */
export async function fanOutToTeachers(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, kind, duration, student_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;

  const { data: student } = await sb
    .from("users")
    .select("name")
    .eq("id", msg.student_id)
    .single();
  const studentName = student?.name ?? `student ${msg.student_id}`;

  const { data: links } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", msg.student_id);
  if (!links?.length) return;
  const teacherIds = links.map((l) => l.teacher_id);

  // Active session check.
  const { data: claim } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", msg.student_id)
    .maybeSingle();
  const handlerId =
    claim && new Date(claim.expires_at).getTime() > Date.now() ? claim.teacher_id : null;

  const handlerName = handlerId
    ? (await sb.from("users").select("name").eq("id", handlerId).single()).data?.name ?? null
    : null;

  const { data: teachers } = await sb
    .from("users")
    .select("id, tg_chat_id, name")
    .in("id", teacherIds);
  if (!teachers?.length) return;

  const bot = getBot();
  const kindLabel = msg.kind === "voice" ? "голосовое" : "круглое видео";
  const durationLabel = formatDuration(msg.duration);
  const actionable = ru.teacherNotificationActionable(studentName, kindLabel, durationLabel);
  const taken = (name: string) => ru.teacherNotificationTaken(name);

  const rows: {
    message_id: number;
    teacher_id: number;
    tg_chat_id: number;
    tg_notification_message_id: number;
  }[] = [];
  for (const t of teachers) {
    const text =
      handlerId && handlerId !== t.id ? taken(handlerName ?? "Тренер") : actionable;
    try {
      const sent = await bot.api.sendMessage(t.tg_chat_id, text);
      rows.push({
        message_id: msg.id,
        teacher_id: t.id,
        tg_chat_id: t.tg_chat_id,
        tg_notification_message_id: sent.message_id,
      });
    } catch (e) {
      console.error("fan-out send failed", e);
    }
  }
  if (rows.length) {
    await sb.from("notifications").insert(rows);
  }
}

export async function editAllNotificationsForMessage(
  messageId: number,
  text: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: notifs } = await sb
    .from("notifications")
    .select("tg_chat_id, tg_notification_message_id")
    .eq("message_id", messageId);
  if (!notifs) return;
  const bot = getBot();
  for (const n of notifs) {
    try {
      await bot.api.editMessageText(n.tg_chat_id, n.tg_notification_message_id, text);
    } catch (e) {
      // Telegram returns 400 when content is unchanged or message is too old; safe to ignore.
      console.warn("editMessageText", e);
    }
  }
}
