import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday } from "@/server/quota";
import { refreshUserAvatar } from "@/server/avatars";
import {
  parseInvitePayload,
  parseRefPayload,
  parseSrcPayload,
  isInviteValid,
  consumeInviteAndUpgrade,
  createTeacherWithInvite,
  createStudent,
  isTgUserBanned,
} from "@/server/invites";
import { recordAudit } from "@/server/audit";
import { fanOutNewUserToAdmins } from "@/server/notifications";
import { getQuotaChatNotificationsEnabled, getReferralsEnabled } from "@/server/settings";
import { sendStep1Welcome, resendCurrentOnboardingStep } from "@/server/onboarding";

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
  const refToken = parseRefPayload(payload);
  const srcSlug = parseSrcPayload(payload);

  if (existing) {
    if (existing.status === "suspended") {
      await ctx.reply(ru.bot.access.suspendedNotice);
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
      await ctx.reply(ru.bot.invites.revokedOrUsed);
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
      await fanOutNewUserToAdmins(teacher.id, "invite");
      await welcomeNewTeacher(ctx);
      return;
    }
    // Race lost — invite consumed between validity check and insert. Tell
    // the user, then fall through and register them as a student.
    await ctx.reply(ru.bot.invites.revokedOrUsed);
  }

  const student = await createStudent({
    tgUserId: from.id,
    tgChatId: chat.id,
    name: display,
    tgUsername,
  });
  if (student) {
    await refreshUserAvatar(student.id, from.id);
    // Referral attribution: only valid for fresh signups, never re-attribution
    // for an existing student. Look up the referrer by token; ignore unknown
    // tokens silently (don't reveal whether a token exists).
    if (refToken && (await getReferralsEnabled())) {
      const { data: referrer } = await sb
        .from("users")
        .select("id")
        .eq("referral_token", refToken)
        .maybeSingle();
      if (referrer && referrer.id !== student.id) {
        // Upsert: a student row may not have a subscription yet (lazy
        // provisioning), so we create-with-attribution in one shot rather
        // than count on getStatus running first.
        await sb.from("subscriptions").upsert(
          {
            user_id: student.id,
            referred_by_user_id: referrer.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        await recordAudit({
          action: "referral.attributed",
          actorId: student.id,
          subjectType: "user",
          subjectId: student.id,
          meta: { referrer_user_id: referrer.id },
        });
      }
    }
    // Acquisition-source attribution (advertiser links). Mutually
    // exclusive with refToken in practice — the start prefix is unique
    // — but if both somehow arrive, the source attribution overwrites
    // the referrer (advertisers win — the explicit campaign wins over a
    // per-user share link).
    if (srcSlug) {
      const { data: source } = await sb
        .from("acquisition_sources")
        .select("id")
        .eq("slug", srcSlug)
        .is("revoked_at", null)
        .maybeSingle();
      if (source) {
        await sb.from("subscriptions").upsert(
          {
            user_id: student.id,
            acquisition_source_id: source.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        await recordAudit({
          action: "acquisition.attributed",
          actorId: student.id,
          subjectType: "user",
          subjectId: student.id,
          meta: { source_id: source.id, slug: srcSlug },
        });
      }
    }
    await recordAudit({
      action: "signup.student",
      actorId: student.id,
      subjectType: "user",
      subjectId: student.id,
      meta: {
        tg_user_id: from.id,
        ref_token_present: !!refToken,
        src_slug: srcSlug ?? null,
      },
    });
    await fanOutNewUserToAdmins(student.id, "start");
  }
  await welcomeNewStudent(ctx, student?.id ?? null);
}

async function welcomeNewStudent(ctx: Context, studentId: number | null): Promise<void> {
  // Onboarding tree starts here. Default subscription state is `welcome`, so
  // we just send Step 1 — clicking "Начать" advances through video1, video2,
  // and the first-voice CTA. createStudent() may have been silently raced;
  // if no row, fall back to the legacy greeting so the user isn't stranded.
  if (studentId == null) {
    await ctx.reply(ru.bot.greetings.studentNew);
    return;
  }
  await sendStep1Welcome(studentId);
}

async function welcomeNewTeacher(ctx: Context): Promise<void> {
  await ctx.reply(ru.bot.invites.consumedTeacher);
}

async function welcomeUpgradedTeacher(ctx: Context): Promise<void> {
  await ctx.reply(ru.bot.invites.upgradedToTeacher);
}

async function welcomeExistingUser(
  ctx: Context,
  user: { role: string; is_admin: boolean; id: number; tz: string },
): Promise<void> {
  if (user.is_admin || user.role === "teacher") {
    await ctx.reply(ru.bot.greetings.teacher);
    return;
  }
  if (user.role === "student") {
    // Mid-onboarding student re-opening the bot: re-send their current step
    // so they can pick up where they left off. Active-practice / done /
    // skipped states fall through to the legacy greeting below.
    const sb = getServiceRoleClient();
    const { data: sub } = await sb
      .from("subscriptions")
      .select("onboarding_state")
      .eq("user_id", user.id)
      .maybeSingle();
    if (sub?.onboarding_state) {
      const resumed = await resendCurrentOnboardingStep(user.id, sub.onboarding_state);
      if (resumed) return;
    }
    if (await getQuotaChatNotificationsEnabled()) {
      const remaining = await getRemainingForToday(user.id, user.tz);
      await ctx.reply(ru.bot.greetings.student(formatDuration(remaining)));
    } else {
      await ctx.reply(ru.bot.greetings.studentNeutral);
    }
    return;
  }
  // Legacy 'pending' rows (pre-rework). Should be empty after the migration's
  // backfill, but keep a sane fallback.
  await ctx.reply(ru.bot.greetings.registered);
}
