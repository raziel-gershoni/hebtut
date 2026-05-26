import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getUsedForToday, decideQuota, commitUsageSplit } from "@/server/quota";
import { serverEnv } from "@/lib/env";
import { fanOutToTeachers, fanOutUnassignedToAdmins } from "@/server/notifications";
import { isTgUserBanned } from "@/server/invites";
import { userHandle } from "@/lib/handle";
import { recordAudit } from "@/server/audit";
import { getQuotaChatNotificationsEnabled, getBillingStarsEnabled } from "@/server/settings";
import { getStatus, canSendMedia, shouldReplyToLockedUser } from "@/server/subscriptions";
import {
  advanceOnboarding,
  cancelTimer,
  computeOnboardingDay,
  scheduleTimer,
  sendStep9Day1LimitDone,
} from "@/server/onboarding";
import { addMinutes } from "date-fns";

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
    const h = userHandle(ctx.from.id);
    await sb.from("users").insert({
      tg_user_id: ctx.from.id,
      tg_chat_id: ctx.chat.id,
      name: ctx.from.first_name ?? ctx.from.username ?? `user ${ctx.from.id}`,
      tg_username: ctx.from.username ?? null,
      display_handle: h.handle,
      display_emoji: h.emoji,
      role: "student",
    });
    await ctx.reply(ru.bot.greetings.studentNew);
    return true;
  }

  if (user.status === "suspended") {
    await ctx.reply(ru.bot.access.suspendedNotice);
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
    await ctx.reply(ru.bot.access.pendingNotice);
    return true;
  }

  if (user.role !== "student") {
    // teacher/admin sending media outside of a reply — not our concern here.
    return false;
  }

  // Subscription gate. Locked statuses (trial_expired / lapsed / payment_failed
  // / frozen) reject the message before we touch quota. We reply once per 24h
  // so a student furiously retrying doesn't get the same template ten times in
  // a row — the silent rejections still fail closed (no fan-out, no row).
  const sub = await getStatus(user.id);
  if (sub && !canSendMedia(sub.derived)) {
    if (shouldReplyToLockedUser(sub.raw.last_lockout_replied_at, new Date())) {
      if (sub.derived.kind === "frozen") {
        const until = sub.derived.untilDate.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
        });
        await ctx.reply(ru.bot.subscription.frozenNotice(until));
      } else {
        // The button label + URL adapt to the billing mode. With Stars on,
        // the deep-link opens the Mini App pay surface (`?startapp=pay`).
        // With Stars off (manual billing), it routes to /feedback so the
        // student can DM the admin. Either way, the bot replies to the
        // locked media at most once per 24h.
        const starsOn = await getBillingStarsEnabled();
        const button = starsOn
          ? {
              text: ru.bot.locked.templateButton,
              url: `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=pay`,
            }
          : {
              text: ru.bot.locked.manualBillingButton,
              url: `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=feedback`,
            };
        await ctx.reply(ru.bot.locked.templateText, {
          reply_markup: { inline_keyboard: [[button]] },
        });
      }
      await sb
        .from("subscriptions")
        .update({
          last_lockout_replied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    }
    return true;
  }

  // Onboarding bypass: a student who records voice instead of tapping
  // through Steps 1–4 still moves the funnel forward. Cancel the 2h/24h
  // nudges that are armed in `cta_record`, advance to awaiting_first_reply,
  // stamp first_msg_at. For students already past these states, only the
  // last_active_at timestamp updates (used for Day-2+ pause detection).
  const onbState = sub?.raw.onboarding_state ?? null;
  const nowIso = new Date().toISOString();
  if (
    onbState === "welcome" ||
    onbState === "video1" ||
    onbState === "video2" ||
    onbState === "awaiting_name" ||
    onbState === "cta_record"
  ) {
    await advanceOnboarding(user.id, "awaiting_first_reply");
    await cancelTimer(user.id, "nudge_2h");
    await cancelTimer(user.id, "nudge_24h");
    await sb
      .from("subscriptions")
      .update({
        onboarding_first_msg_at: nowIso,
        onboarding_last_active_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", user.id);
  } else if (onbState && onbState !== "done_skipped" && onbState !== "done_paid" && onbState !== "done_churned") {
    // Active student in any non-terminal onboarding state — bump last-active
    // for the day-2+ pause sweep.
    await sb
      .from("subscriptions")
      .update({ onboarding_last_active_at: nowIso, updated_at: nowIso })
      .eq("user_id", user.id);
  }

  // Duration is read straight from the webhook payload — never download to measure.
  const usedToday = await getUsedForToday(user.id, user.tz);
  const decision = decideQuota({
    usedToday,
    dailyQuota: serverEnv.DAILY_QUOTA_SECONDS,
    graceSeconds: serverEnv.OVERFLOW_GRACE_SECONDS,
    messageDuration: duration,
  });
  // Single read, reused for both the rejection and the success replies below.
  const quotaChat = await getQuotaChatNotificationsEnabled();
  if (!decision.ok) {
    if (quotaChat) {
      await ctx.reply(
        decision.remainingIncludingGrace > 0
          ? ru.bot.quota.overQuota(formatDuration(decision.remainingIncludingGrace))
          : ru.bot.quota.overQuotaExhausted,
      );
    } else {
      await ctx.reply(ru.bot.quota.rejectedNeutral);
    }
    return true;
  }

  // Look up assigned teacher(s). Unlike before, we DO NOT early-return when
  // there are none — the message still gets recorded so admins can see it in
  // their inbox and assign a teacher after the fact. The fan-out branch below
  // routes either to the linked teachers or to all admins.
  const { data: links } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", user.id);
  const hasTeachers = (links?.length ?? 0) > 0;

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
    await ctx.reply(ru.bot.access.unknownInput);
    return true;
  }

  await recordAudit({
    action: "message.in",
    actorId: user.id,
    subjectType: "message",
    subjectId: inserted.id,
    meta: { kind, duration, student_id: user.id },
  });

  await commitUsageSplit(user.id, user.tz, decision.todayDebit, decision.tomorrowDebit);

  // Choose the reply: overflow > low-warning > normal. Each takes priority
  // because the more urgent state should not be hidden by the cheerier copy.
  // When the global toggle is off the entire quota narrative is suppressed —
  // the student gets a flat "✅ Отправлено." and reads remaining time on the
  // Mini App dashboard instead.
  //
  // Unassigned-student branch: the message is recorded, but no teacher exists
  // to pick it up. Send the dedicated ack so the student knows we received
  // them, and DM all admins with a one-tap link to assign a teacher.
  if (hasTeachers) {
    let reply: string;
    if (!quotaChat) {
      reply = ru.bot.quota.acceptedNeutral;
    } else if (decision.tomorrowDebit > 0) {
      reply = ru.bot.quota.acceptedOverflow(formatDuration(decision.tomorrowDebit));
    } else if (decision.newRemainingToday > 0 && decision.newRemainingToday <= 60) {
      reply = ru.bot.quota.acceptedLow(formatDuration(decision.newRemainingToday));
    } else {
      reply = ru.bot.quota.accepted(formatDuration(decision.newRemainingToday));
    }
    await ctx.reply(reply);
    await fanOutToTeachers(inserted.id);
  } else {
    // Send the "got it, hooking a coach up" ack only once per student.
    // Admin fan-out still fires every time so each new message reaches
    // the admin pool even after the first ack has been sent.
    if (!sub?.raw.unassigned_ack_sent_at) {
      await ctx.reply(ru.bot.access.unassignedAck);
      const ackIso = new Date().toISOString();
      await sb
        .from("subscriptions")
        .update({ unassigned_ack_sent_at: ackIso, updated_at: ackIso })
        .eq("user_id", user.id);
    }
    await fanOutUnassignedToAdmins(inserted.id);
  }

  // Onboarding limit-hit hooks. Run after the success reply so any failure
  // here doesn't break the student's normal flow.
  if (decision.newRemainingToday === 0 && sub) {
    const day = computeOnboardingDay(sub.raw.trial_started_at, new Date(), user.tz);
    if (day === 1 && sub.raw.onboarding_day1_limit_msg_sent_at == null) {
      // Step 9: soft "you're done for today" — fires at most once per trial.
      await sendStep9Day1LimitDone(user.id);
      const stamp = new Date().toISOString();
      await sb
        .from("subscriptions")
        .update({
          onboarding_day1_limit_msg_sent_at: stamp,
          updated_at: stamp,
        })
        .eq("user_id", user.id);
    } else if (
      day >= 2 &&
      sub.raw.onboarding_state !== "day2_conversion_pending" &&
      sub.raw.onboarding_state !== "done_paid" &&
      sub.raw.onboarding_state !== "done_churned" &&
      sub.raw.onboarding_state !== "done_skipped" &&
      sub.raw.onboarding_state !== "awaiting_survey" &&
      sub.raw.onboarding_state !== "survey_yes" &&
      sub.raw.onboarding_state !== "survey_later" &&
      sub.raw.onboarding_state !== "survey_no" &&
      sub.raw.onboarding_state !== "churn_followup_pending"
    ) {
      // Step 11: end-of-trial conversion CTA, fires 5 minutes after the
      // limit hit so the "✅ Отправлено." reply has its breath. The cron
      // sends the actual message + payment button.
      await advanceOnboarding(user.id, "day2_conversion_pending");
      await scheduleTimer(user.id, "day2_conversion", addMinutes(new Date(), 5));
    }
  }

  return true;
}
