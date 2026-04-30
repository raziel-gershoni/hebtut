import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";
import { ru, formatDuration } from "@/lib/i18n";
import { formatWhen } from "@/lib/time";
import { editAllNotificationsForMessage } from "./notifications";
import type { MessageDirection, MessageStatus } from "@/types/database";

export type ReplyKind = "claim" | "session-refresh" | "followup";

export type StartDecision =
  | { ok: true; kind: ReplyKind }
  | { ok: false; reason: "taken-by-other" | "orphaned" | "outbound" };

export interface DecideInput {
  msgDirection: MessageDirection;
  msgStatus: MessageStatus;
  /** null when there is no claim, or when the existing claim is expired. */
  activeClaimTeacherId: number | null;
  teacherId: number;
}

/**
 * Pure decision rule — keeps the whole policy testable without DB or TG mocks.
 */
export function decideReplyKind(input: DecideInput): StartDecision {
  if (input.msgDirection === "out") return { ok: false, reason: "outbound" };
  if (input.msgStatus === "orphaned") return { ok: false, reason: "orphaned" };

  // Other-teacher block (regardless of message status).
  if (
    input.activeClaimTeacherId !== null &&
    input.activeClaimTeacherId !== input.teacherId
  ) {
    return { ok: false, reason: "taken-by-other" };
  }

  if (input.msgStatus === "answered") return { ok: true, kind: "followup" };

  // pending or expired — claim or refresh by self
  return {
    ok: true,
    kind: input.activeClaimTeacherId === input.teacherId ? "session-refresh" : "claim",
  };
}

export type StartReplyResult =
  | { ok: true; kind: ReplyKind; promptMessageId: number }
  | {
      ok: false;
      reason: "taken-by-other" | "orphaned" | "outbound" | "not-found" | "not-allowed" | "fatal";
    };

/**
 * Orchestrates "start a reply for this message" — the single entry point for
 * both the inbox claim flow and the per-thread "Ответить" button.
 */
export async function startReply(messageId: number, teacherId: number): Promise<StartReplyResult> {
  const sb = getServiceRoleClient();

  const { data: msg } = await sb
    .from("messages")
    .select("id, direction, status, student_id, kind, duration, created_at")
    .eq("id", messageId)
    .single();
  if (!msg) return { ok: false, reason: "not-found" };

  // Verify the teacher is linked to this student.
  const { data: link } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", msg.student_id)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!link) return { ok: false, reason: "not-allowed" };

  // Read the active claim (if any) for this student.
  const { data: claim } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", msg.student_id)
    .maybeSingle();
  const claimActive =
    !!claim && new Date(claim.expires_at).getTime() > Date.now();
  const activeClaimTeacherId = claimActive ? claim.teacher_id : null;

  const decision = decideReplyKind({
    msgDirection: msg.direction,
    msgStatus: msg.status,
    activeClaimTeacherId,
    teacherId,
  });
  if (!decision.ok) return decision;

  // Atomic claim upsert (PK on student_id ⇒ at most one teacher per student).
  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const { error: upsertErr } = await sb
    .from("claims")
    .upsert(
      {
        student_id: msg.student_id,
        teacher_id: teacherId,
        claimed_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "student_id" },
    );
  if (upsertErr) {
    console.error("claim upsert failed", upsertErr.message);
    return { ok: false, reason: "fatal" };
  }

  // Send prompt DM to the teacher.
  const [{ data: student }, { data: teacher }] = await Promise.all([
    sb.from("users").select("name").eq("id", msg.student_id).single(),
    sb.from("users").select("tg_chat_id, name, tz").eq("id", teacherId).single(),
  ]);
  if (!teacher) return { ok: false, reason: "fatal" };

  const studentName = student?.name ?? `student ${msg.student_id}`;
  const dur = formatDuration(msg.duration);
  const when = formatWhen(msg.created_at, teacher.tz);
  const promptText =
    decision.kind === "followup"
      ? ru.teacherFollowupPrompt(studentName, dur, when)
      : ru.teacherClaimPrompt(studentName, dur, when);
  const sent = await getBot().api.sendMessage(teacher.tg_chat_id, promptText);

  await sb.from("prompts").insert({
    teacher_id: teacherId,
    student_message_id: messageId,
    tg_chat_id: teacher.tg_chat_id,
    tg_prompt_message_id: sent.message_id,
  });

  // For a fresh "claim", edit other teachers' notifications for this student's
  // pending messages so they see "T handling". On session-refresh / followup
  // these notifications are already in that state; calling the helper is a
  // safe no-op (TG returns 400 'message is not modified', which we swallow).
  if (decision.kind === "claim") {
    const teacherName = teacher.name ?? "Тренер";
    const { data: pendingMsgs } = await sb
      .from("messages")
      .select("id")
      .eq("student_id", msg.student_id)
      .eq("status", "pending");
    for (const m of pendingMsgs ?? []) {
      await editAllNotificationsForMessage(m.id, ru.teacherNotificationTaken(teacherName));
    }
  }

  return { ok: true, kind: decision.kind, promptMessageId: sent.message_id };
}
