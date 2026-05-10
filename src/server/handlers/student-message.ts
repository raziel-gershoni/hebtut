import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getUsedForToday, decideQuota, commitUsageSplit } from "@/server/quota";
import { serverEnv } from "@/lib/env";
import { fanOutToTeachers } from "@/server/notifications";
import { isTgUserBanned } from "@/server/invites";
import { userHandle } from "@/lib/handle";
import { recordAudit } from "@/server/audit";
import { getQuotaChatNotificationsEnabled, getBillingStarsEnabled } from "@/server/settings";
import { getStatus, canSendMedia, shouldReplyToLockedUser } from "@/server/subscriptions";
import { advanceOnboarding, cancelTimer } from "@/server/onboarding";

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
        await ctx.reply(ru.frozenNotice(until));
      } else {
        // The button label + URL adapt to the billing mode. With Stars on,
        // the deep-link opens the Mini App pay surface (`?startapp=pay`).
        // With Stars off (manual billing), it routes to /feedback so the
        // student can DM the admin. Either way, the bot replies to the
        // locked media at most once per 24h.
        const starsOn = await getBillingStarsEnabled();
        const button = starsOn
          ? {
              text: ru.lockedTemplateButton,
              url: `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=pay`,
            }
          : {
              text: ru.manualBillingButton,
              url: `https://t.me/${serverEnv.TELEGRAM_BOT_USERNAME}?startapp=feedback`,
            };
        await ctx.reply(ru.lockedTemplateText, {
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
          ? ru.overQuota(formatDuration(decision.remainingIncludingGrace))
          : ru.overQuotaExhausted,
      );
    } else {
      await ctx.reply(ru.quotaRejectedNeutral);
    }
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
  let reply: string;
  if (!quotaChat) {
    reply = ru.acceptedStudentNeutral;
  } else if (decision.tomorrowDebit > 0) {
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
