import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "./notifications";

export interface ClaimableMessage {
  status: string;
  claimed_by_teacher_id: number | null;
}

export function canClaim(msg: ClaimableMessage, teacherId: number): boolean {
  if (msg.status === "pending") return true;
  if (msg.status === "claimed" && msg.claimed_by_teacher_id === teacherId) return true;
  return false;
}

export type ClaimResult =
  | { ok: true; promptMessageId: number }
  | { ok: false; reason: "race" | "fatal" | "not-allowed" };

export async function claimMessage(messageId: number, teacherId: number): Promise<ClaimResult> {
  const sb = getServiceRoleClient();

  // Verify the teacher is linked to this student before attempting transition.
  const { data: msgRow } = await sb
    .from("messages")
    .select("id, student_id, status, claimed_by_teacher_id")
    .eq("id", messageId)
    .single();
  if (!msgRow) return { ok: false, reason: "fatal" };
  if (!canClaim(msgRow, teacherId)) return { ok: false, reason: "race" };

  const { data: link } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", msgRow.student_id)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!link) return { ok: false, reason: "not-allowed" };

  // Atomic transition: only update if still pending OR already by us.
  // We pre-checked but a race is still possible — the .or filter prevents us from stealing
  // a claim made between the two queries.
  const { data: updated } = await sb
    .from("messages")
    .update({
      status: "claimed",
      claimed_by_teacher_id: teacherId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .or(`status.eq.pending,and(status.eq.claimed,claimed_by_teacher_id.eq.${teacherId})`)
    .select("id, kind, duration, student_id")
    .maybeSingle();
  if (!updated) return { ok: false, reason: "race" };

  const [{ data: student }, { data: teacher }] = await Promise.all([
    sb.from("users").select("name").eq("id", updated.student_id).single(),
    sb.from("users").select("tg_chat_id, name").eq("id", teacherId).single(),
  ]);
  if (!teacher) return { ok: false, reason: "fatal" };

  const studentName = student?.name ?? `student ${updated.student_id}`;
  const promptText = ru.teacherClaimPrompt(studentName, formatDuration(updated.duration));
  const sent = await getBot().api.sendMessage(teacher.tg_chat_id, promptText);

  await sb.from("prompts").insert({
    teacher_id: teacherId,
    student_message_id: messageId,
    tg_chat_id: teacher.tg_chat_id,
    tg_prompt_message_id: sent.message_id,
  });

  const teacherName = teacher.name ?? "Преподаватель";
  await editAllNotificationsForMessage(messageId, ru.teacherNotificationTaken(teacherName));

  return { ok: true, promptMessageId: sent.message_id };
}

export async function releaseClaim(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  await sb
    .from("messages")
    .update({ status: "pending", claimed_by_teacher_id: null, claimed_at: null })
    .eq("id", messageId);

  const { data: msg } = await sb
    .from("messages")
    .select("kind, duration, student_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;
  const { data: student } = await sb.from("users").select("name").eq("id", msg.student_id).single();
  const studentName = student?.name ?? "ученик";
  const kindLabel = msg.kind === "voice" ? "голосовое" : "круглое видео";
  await editAllNotificationsForMessage(
    messageId,
    ru.teacherNotificationActionable(studentName, kindLabel, formatDuration(msg.duration)),
  );
}
