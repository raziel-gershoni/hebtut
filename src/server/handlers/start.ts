import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday } from "@/server/quota";
import { refreshUserAvatar } from "@/server/avatars";
import {
  parseInvitePayload,
  isInviteValid,
  consumeInviteAndUpgrade,
  createTeacherWithInvite,
  createStudent,
  isTgUserBanned,
} from "@/server/invites";
import { recordAudit } from "@/server/audit";

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) return;

  // Banned: silent block. No reply, no row touched.
  if (await isTgUserBanned(from.id)) return;

  const sb = getServiceRoleClient();
  const display =
    [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
    from.username ||
    `user ${from.id}`;
  const tgUsername = from.username ?? null;

  const { data: existing } = await sb
    .from("users")
    .select("id, role, is_admin, status, tz")
    .eq("tg_user_id", from.id)
    .maybeSingle();

  const payload = typeof ctx.match === "string" ? ctx.match : "";
  const token = parseInvitePayload(payload);

  if (existing) {
    if (existing.status === "suspended") {
      await ctx.reply(ru.suspendedNotice);
      return;
    }
    await sb
      .from("users")
      .update({ tg_chat_id: chat.id, name: display, tg_username: tgUsername })
      .eq("id", existing.id);
    await refreshUserAvatar(existing.id, from.id);

    // Existing student opening a fresh invite link → upgrade to teacher.
    if (token && existing.role === "student") {
      const upgraded = await consumeInviteAndUpgrade(token, existing.id);
      if (upgraded) {
        await recordAudit({
          action: "invite.consume",
          actorId: existing.id,
          subjectType: "user",
          subjectId: existing.id,
          meta: { via: "invite-upgrade", role_to: "teacher" },
        });
        await welcomeUpgradedTeacher(ctx);
        return;
      }
      // Token invalid or already consumed — fall through to standard greeting.
      await ctx.reply(ru.inviteRevokedOrUsed);
    }

    await welcomeExistingUser(ctx, existing);
    return;
  }

  // New user. Decide the path *before* the insert so each welcome flow can
  // run its own onboarding (e.g., a future student-only video guide).
  if (token && (await isInviteValid(token))) {
    const teacher = await createTeacherWithInvite({
      tgUserId: from.id,
      tgChatId: chat.id,
      name: display,
      tgUsername,
      token,
    });
    if (teacher) {
      await refreshUserAvatar(teacher.id, from.id);
      await recordAudit({
        action: "signup.teacher",
        actorId: teacher.id,
        subjectType: "user",
        subjectId: teacher.id,
        meta: { via: "invite", tg_user_id: from.id },
      });
      await welcomeNewTeacher(ctx);
      return;
    }
    // Race lost — invite consumed between validity check and insert. Tell
    // the user, then fall through and register them as a student.
    await ctx.reply(ru.inviteRevokedOrUsed);
  }

  const student = await createStudent({
    tgUserId: from.id,
    tgChatId: chat.id,
    name: display,
    tgUsername,
  });
  if (student) {
    await refreshUserAvatar(student.id, from.id);
    await recordAudit({
      action: "signup.student",
      actorId: student.id,
      subjectType: "user",
      subjectId: student.id,
      meta: { tg_user_id: from.id },
    });
  }
  await welcomeNewStudent(ctx);
}

async function welcomeNewStudent(ctx: Context): Promise<void> {
  // TODO(onboarding): send the student welcome video guide here. This is the
  // student-only seam — the teacher path must not run this code.
  await ctx.reply(ru.greetingStudentNew);
}

async function welcomeNewTeacher(ctx: Context): Promise<void> {
  await ctx.reply(ru.inviteConsumedTeacher);
}

async function welcomeUpgradedTeacher(ctx: Context): Promise<void> {
  await ctx.reply(ru.upgradedToTeacher);
}

async function welcomeExistingUser(
  ctx: Context,
  user: { role: string; is_admin: boolean; id: number; tz: string },
): Promise<void> {
  if (user.is_admin || user.role === "teacher") {
    await ctx.reply(ru.greetingTeacher);
    return;
  }
  if (user.role === "student") {
    const remaining = await getRemainingForToday(user.id, user.tz);
    await ctx.reply(ru.greetingStudent(formatDuration(remaining)));
    return;
  }
  // Legacy 'pending' rows (pre-rework). Should be empty after the migration's
  // backfill, but keep a sane fallback.
  await ctx.reply(ru.greetingRegistered);
}
