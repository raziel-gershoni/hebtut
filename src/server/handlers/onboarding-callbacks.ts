import type { Context } from "grammy";
import { addDays, addHours } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru } from "@/lib/i18n";
import {
  advanceOnboarding,
  cancelTimer,
  markOnboardingDone,
  nextSafeFireTime,
  scheduleTimer,
  sendStep2Video1,
  sendStep3Video2,
  sendStep4CtaRecord,
  sendStep12_1OpenAccess,
  sendStep12_2LaterAck,
  sendStep12_3Video3,
} from "@/server/onboarding";
import type { OnboardingState } from "@/types/database";

/**
 * Handles every `onb:*` callback_query from the onboarding inline keyboards.
 * Always answers the callback (so TG stops showing the spinner) and edits
 * the source message to remove the inline keyboard so a second click can't
 * double-fire. State mismatch ⇒ short-toast "Кнопка устарела" and no-op,
 * which catches stale messages from a previous onboarding attempt.
 */
export async function handleOnboardingCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const tgUserId = ctx.from?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.callbackQuery?.message?.chat.id;
  if (!data || !tgUserId) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Look up the student by their Telegram id.
  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!user || user.role !== "student") {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  const { data: sub } = await sb
    .from("subscriptions")
    .select("onboarding_state, response_window_start, response_window_end, response_window_tz")
    .eq("user_id", user.id)
    .maybeSingle();
  const state = (sub?.onboarding_state ?? "done_skipped") as OnboardingState;

  // Helper: ack + dismiss the inline keyboard. Edit fails silently if the
  // message is too old or already edited — TG returns 400, we ignore.
  const ack = async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (chatId != null && messageId != null) {
      await ctx.api
        .editMessageReplyMarkup(chatId, messageId, {
          reply_markup: { inline_keyboard: [] },
        })
        .catch(() => {});
    }
  };

  const stale = async () => {
    await ctx.answerCallbackQuery({ text: ru.onbStaleButton }).catch(() => {});
  };

  switch (data) {
    case "onb:start": {
      if (state !== "welcome") return stale();
      await advanceOnboarding(user.id, "video1");
      await ack();
      await sendStep2Video1(user.id);
      return;
    }
    case "onb:continue": {
      if (state !== "video1") return stale();
      await advanceOnboarding(user.id, "video2");
      await ack();
      await sendStep3Video2(user.id);
      return;
    }
    case "onb:next": {
      if (state !== "video2") return stale();
      await advanceOnboarding(user.id, "cta_record");
      await ack();
      await sendStep4CtaRecord(user.id);
      // Schedule the 2h soft + 24h hard nudges. The 24h nudge respects quiet
      // hours via the user's response_window (or 08–22 fallback).
      const now = new Date();
      const tz = sub?.response_window_tz ?? "Asia/Jerusalem";
      await scheduleTimer(user.id, "nudge_2h", addHours(now, 2));
      await scheduleTimer(
        user.id,
        "nudge_24h",
        nextSafeFireTime(
          addHours(now, 24),
          sub?.response_window_start ?? null,
          sub?.response_window_end ?? null,
          tz,
        ),
      );
      return;
    }
    case "onb:survey:yes": {
      if (state !== "awaiting_survey") return stale();
      await advanceOnboarding(user.id, "survey_yes");
      await ack();
      await sendStep12_1OpenAccess(user.id);
      return;
    }
    case "onb:survey:later": {
      if (state !== "awaiting_survey") return stale();
      await advanceOnboarding(user.id, "survey_later");
      await ack();
      await sendStep12_2LaterAck(user.id);
      // 5d follow-up: Step 12.3 video 3 with the chat-support CTA. Subject
      // to quiet hours (we already DM with a real message; respect tz).
      const now = new Date();
      const tz = sub?.response_window_tz ?? "Asia/Jerusalem";
      await scheduleTimer(
        user.id,
        "churn_followup",
        nextSafeFireTime(
          addDays(now, 5),
          sub?.response_window_start ?? null,
          sub?.response_window_end ?? null,
          tz,
        ),
      );
      return;
    }
    case "onb:survey:no": {
      if (state !== "awaiting_survey") return stale();
      // Send Video 3 immediately, then mark done_churned. The two ops are
      // separated so a TG send hiccup still leaves a clear closed state.
      await advanceOnboarding(user.id, "survey_no");
      await ack();
      await sendStep12_3Video3(user.id);
      await markOnboardingDone(user.id, "churned");
      // Cancel the (likely already-fired) survey timer; nothing else outstanding.
      await cancelTimer(user.id, "survey");
      return;
    }
    default: {
      // Unknown onb:* code (forward-compat / old client). Ack to dismiss the spinner.
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
  }
}
