import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";
import { ru, formatDuration } from "@/lib/i18n";
import { formatWhen } from "@/lib/time";
import { resolveDisplay, type DisplayRow } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";
import { editAllNotificationsForMessage } from "./notifications";
import { recordAudit } from "./audit";
import type { MessageDirection, MessageStatus } from "@/types/database";

// All SELECTs that feed a user-facing display label MUST pull the same
// columns so the resolver can pick preferred_name → name → handle by
// global toggle. Keeping the column list in one place avoids "the
// student looks right in the inbox but the tutor's DM says Ретивый
// Кабан" drift.
const DISPLAY_COLUMNS =
  "tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id";

function labelFromRow(row: DisplayRow | null | undefined, anonMode: boolean): string {
  return resolveDisplay(row, anonMode).handle;
}

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

  await recordAudit({
    action: "claim.refresh",
    actorId: teacherId,
    subjectType: "claim",
    subjectId: msg.student_id,
    meta: {
      kind: decision.kind,
      expires_at: expiresAt,
      message_id: messageId,
      student_id: msg.student_id,
    },
  });

  // Send prompt DM to the teacher.
  const [{ data: student }, { data: teacher }, anonMode] = await Promise.all([
    sb
      .from("users")
      .select(DISPLAY_COLUMNS)
      .eq("id", msg.student_id)
      .single(),
    sb
      .from("users")
      .select(`${DISPLAY_COLUMNS}, tg_chat_id, tz`)
      .eq("id", teacherId)
      .single(),
    getDisplayAnonymousHandlesEnabled(),
  ]);
  if (!teacher) return { ok: false, reason: "fatal" };

  const studentHandle = labelFromRow(student, anonMode);
  const dur = formatDuration(msg.duration);
  const when = formatWhen(msg.created_at, teacher.tz);
  const promptText =
    decision.kind === "followup"
      ? ru.bot.notifications.teacherFollowupPrompt(studentHandle, dur, when)
      : ru.bot.notifications.teacherClaimPrompt(studentHandle, dur, when);
  const sent = await getBot().api.sendMessage(teacher.tg_chat_id, promptText);

  await sb.from("prompts").insert({
    teacher_id: teacherId,
    student_id: msg.student_id,
    student_message_id: messageId,
    tg_chat_id: teacher.tg_chat_id,
    tg_prompt_message_id: sent.message_id,
  });

  // For a fresh "claim", edit other teachers' notifications for this student's
  // pending messages so they see "T handling". On session-refresh / followup
  // these notifications are already in that state; calling the helper is a
  // safe no-op (TG returns 400 'message is not modified', which we swallow).
  if (decision.kind === "claim") {
    const teacherHandle = labelFromRow(teacher, anonMode);
    const { data: pendingMsgs } = await sb
      .from("messages")
      .select("id")
      .eq("student_id", msg.student_id)
      .eq("status", "pending");
    for (const m of pendingMsgs ?? []) {
      await editAllNotificationsForMessage(
        m.id,
        ru.bot.notifications.teacherNotificationTaken(teacherHandle, studentHandle),
      );
    }
  }

  return { ok: true, kind: decision.kind, promptMessageId: sent.message_id };
}

export type StartInitiationResult =
  | { ok: true; kind: "initiate"; promptMessageId: number }
  | { ok: false; reason: "taken-by-other" | "not-allowed" | "not-found" | "fatal" };

/**
 * Pure decision: can `teacherId` initiate a chat given the currently active
 * claim holder (or null if no claim is active)? Mirrors the same semantics
 * baked into decideReplyKind's "taken-by-other" rule, kept separate so the
 * initiate path can be exercised in isolation.
 */
export function decideInitiation(input: {
  activeClaimTeacherId: number | null;
  teacherId: number;
}): { ok: true } | { ok: false; reason: "taken-by-other" } {
  if (
    input.activeClaimTeacherId !== null &&
    input.activeClaimTeacherId !== input.teacherId
  ) {
    return { ok: false, reason: "taken-by-other" };
  }
  return { ok: true };
}

/**
 * Teacher-initiated outbound: lets a teacher seed a chat with a linked
 * student even when there's no incoming message to reply to. Mirrors
 * startReply's claim/prompt machinery but without the original-message
 * lookup, decision rule, or notification edits — there's nothing to
 * "answer" on the way in.
 */
export async function startInitiation(
  teacherId: number,
  studentId: number,
): Promise<StartInitiationResult> {
  const sb = getServiceRoleClient();

  const { data: link } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", studentId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!link) return { ok: false, reason: "not-allowed" };

  const { data: claim } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", studentId)
    .maybeSingle();
  const claimActive = !!claim && new Date(claim.expires_at).getTime() > Date.now();
  const decision = decideInitiation({
    activeClaimTeacherId: claimActive ? claim.teacher_id : null,
    teacherId,
  });
  if (!decision.ok) return decision;
  // Only edit other teachers' notifications on a *fresh* claim — not when
  // the same teacher already holds it and we're just refreshing the TTL.
  const isFreshClaim = !(claimActive && claim.teacher_id === teacherId);

  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const { error: upsertErr } = await sb
    .from("claims")
    .upsert(
      {
        student_id: studentId,
        teacher_id: teacherId,
        claimed_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "student_id" },
    );
  if (upsertErr) {
    console.error("initiation claim upsert failed", upsertErr.message);
    return { ok: false, reason: "fatal" };
  }

  await recordAudit({
    action: "claim.refresh",
    actorId: teacherId,
    subjectType: "claim",
    subjectId: studentId,
    meta: {
      kind: isFreshClaim ? "initiate" : "session-refresh",
      expires_at: expiresAt,
      student_id: studentId,
    },
  });

  const [{ data: student }, { data: teacher }, anonMode] = await Promise.all([
    sb
      .from("users")
      .select(DISPLAY_COLUMNS)
      .eq("id", studentId)
      .single(),
    sb
      .from("users")
      .select(`${DISPLAY_COLUMNS}, tg_chat_id`)
      .eq("id", teacherId)
      .single(),
    getDisplayAnonymousHandlesEnabled(),
  ]);
  if (!teacher) return { ok: false, reason: "fatal" };

  const studentHandle = labelFromRow(student, anonMode);
  const sent = await getBot().api.sendMessage(
    teacher.tg_chat_id,
    ru.bot.notifications.teacherInitiatePrompt(studentHandle),
  );

  await sb.from("prompts").insert({
    teacher_id: teacherId,
    student_id: studentId,
    student_message_id: null,
    tg_chat_id: teacher.tg_chat_id,
    tg_prompt_message_id: sent.message_id,
  });

  // Mirror startReply: when the claim freshly transfers (or freshly opens),
  // mark every other linked teacher's existing pending-message notifications
  // for this student as "in работе у X" so they don't try to claim something
  // we now own.
  if (isFreshClaim) {
    const teacherHandle = labelFromRow(teacher, anonMode);
    const { data: pendingMsgs } = await sb
      .from("messages")
      .select("id")
      .eq("student_id", studentId)
      .eq("status", "pending");
    for (const m of pendingMsgs ?? []) {
      await editAllNotificationsForMessage(
        m.id,
        ru.bot.notifications.teacherNotificationTaken(teacherHandle, studentHandle),
      );
    }
  }

  return { ok: true, kind: "initiate", promptMessageId: sent.message_id };
}
