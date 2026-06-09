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
  sendStepNameAsk,
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
    // Surface this instead of silent-no-op — debugging "nothing happens
    // when I click" is impossible if every failure mode returns silently.
    await ctx
      .answerCallbackQuery({
        text: !user
          ? "Не нашёл твою регистрацию — нажми /start заново"
          : "Это шаги онбординга для пользователя, а ты не пользователь",
        show_alert: true,
      })
      .catch(() => {});
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
    // show_alert=true makes this a modal the user has to dismiss, instead
    // of a subtle toast that disappears in 2 s — much easier to spot in
    // iOS TG. Also append the current state so we can debug "the button
    // does nothing" reports without needing server logs.
    await ctx
      .answerCallbackQuery({
        text: `${ru.bot.onboarding.staleButton} (состояние: ${state})`,
        show_alert: true,
      })
      .catch(() => {});
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
      // Dale → ask for the name FIRST (state=awaiting_name). Timers for
      // 2h/24h nudges are NOT scheduled here — they'd fire while the
      // student is stuck at name-ask and waste the slot (the cron checks
      // state==='cta_record'). Schedule them in the name-input handler
      // when the student actually moves into cta_record.
      await advanceOnboarding(user.id, "awaiting_name");
      await ack();
      await sendStepNameAsk(user.id);
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

const MAX_NAME_LENGTH = 50;

/**
 * Captures the student's typed name during the awaiting_name onboarding
 * state. Validates length, stores into users.name, advances to cta_record,
 * sends the record-CTA, and schedules the 2h/24h nudges from this point
 * (which is when the student is actually ready to record — scheduling at
 * the earlier onb:next would burn the timer slot while the student is
 * still typing their name).
 *
 * Returns true if THIS handler consumed the message (so the webhook
 * doesn't fall through to handleTeacherReplyText or handleUnknown).
 * Returns false otherwise (sender isn't a student in awaiting_name,
 * message is a slash command, etc.).
 */
export async function handleOnboardingNameInput(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from || !msg.text) return false;
  // Slash commands are routed via bot.command() — never treat as a name.
  if (msg.text.startsWith("/")) return false;

  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, tz")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();
  if (!user || user.role !== "student") return false;

  const { data: subRow } = await sb
    .from("subscriptions")
    .select("onboarding_state, response_window_start, response_window_end, response_window_tz")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!subRow || subRow.onboarding_state !== "awaiting_name") return false;

  // We're definitely in awaiting_name from here on — consume the message
  // regardless of validation outcome. Bot replies guide them to a valid name.
  const rawName = msg.text.trim();
  if (rawName.length === 0) {
    await ctx.reply(ru.bot.onboarding.nameTooShort);
    return true;
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    await ctx.reply(ru.bot.onboarding.nameTooLong);
    return true;
  }
  // Single-line: TG text inputs usually don't include newlines, but a paste
  // could. Collapse to single line so the name renders cleanly in chat
  // bubbles and the admin panel.
  const name = rawName.replace(/\s+/g, " ");

  // Write to preferred_name (decoupled from the TG-synced `name` column).
  // /start re-syncs `name` on every interaction; preferred_name persists
  // independently and is what peer-facing surfaces actually render.
  await sb.from("users").update({ preferred_name: name }).eq("id", user.id);
  await advanceOnboarding(user.id, "cta_record");

  // Schedule the 2h soft + 24h hard nudges from THIS moment (entering
  // cta_record). The 24h nudge respects quiet hours via response_window or
  // the 08–22 fallback.
  const now = new Date();
  const tz = subRow.response_window_tz ?? "Asia/Jerusalem";
  await scheduleTimer(user.id, "nudge_2h", addHours(now, 2));
  await scheduleTimer(
    user.id,
    "nudge_24h",
    nextSafeFireTime(
      addHours(now, 24),
      subRow.response_window_start ?? null,
      subRow.response_window_end ?? null,
      tz,
    ),
  );

  // Brief acknowledgment + the record-CTA in two messages so the personal
  // greeting doesn't compete with the action.
  await ctx.reply(ru.bot.onboarding.nameThanks(name));
  await sendStep4CtaRecord(user.id);
  return true;
}
