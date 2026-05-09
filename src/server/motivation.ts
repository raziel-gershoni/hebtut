import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";
import type { DerivedStatus } from "@/server/subscriptions";

/**
 * Motivation copy library. Keys are stable so the no-repeat-yesterday rule
 * works across deploys: changing copy preserves keys; renaming a key invalidates
 * one persisted last_motivation_key entry, harmless.
 *
 * Pools mirror the spec's "Блок Мотивация" table:
 *   - zero_no_teacher_yet: 0-min day, no pending teacher message in thread
 *   - zero_teacher_started: 0-min day, last message in thread is teacher's
 *   - one_to_four: 1–4 minutes practiced
 *   - five: full quota done
 *   - trial_ending: trial in last 24-48h regardless of practice
 *   - no_access: trial_expired / lapsed / frozen
 *   - payment_failed: provider returned an error
 */
type Pool = readonly { key: string; text: string }[];

const MOTIVATION: Record<string, Pool> = {
  zero_no_teacher_yet: [
    { key: "zntg.start_short", text: "Начни с короткого голосового" },
    { key: "zntg.start_anytime", text: "Можно начать в любой момент" },
    { key: "zntg.few_words", text: "Просто скажи пару фраз" },
    { key: "zntg.coach_will_join", text: "Начни сейчас, тренер подключится" },
    { key: "zntg.first_step", text: "Первый шаг — одно голосовое" },
  ],
  zero_teacher_started: [
    { key: "zts.coach_started", text: "Тренер уже начал — ответь голосовым" },
    { key: "zts.coach_waiting", text: "Тренер ждёт ответ" },
    { key: "zts.reply_to_coach", text: "Ответь на голосовое тренера" },
    { key: "zts.short_reply", text: "Запиши короткий ответ тренеру" },
  ],
  one_to_four: [
    { key: "otf.one_more", text: "Отлично, ещё одно голосовое" },
    { key: "otf.good_pace", text: "Классный темп, добираем дальше" },
    { key: "otf.almost_closed", text: "Ещё немного — и день закрыт" },
    { key: "otf.step_by_step", text: "Шаг за шагом идём к свободной речи" },
  ],
  five: [
    { key: "five.great_job", text: "Отличная работа 👍" },
    { key: "five.strong_day", text: "Сильный день, завтра продолжим 💪" },
    { key: "five.progress_built", text: "Так строится прогресс 🔥" },
  ],
  trial_ending: [
    { key: "te.dont_stop", text: "Не останавливаемся на старте" },
    { key: "te.toward_result", text: "Продолжим идти к результату" },
    { key: "te.daily_practice", text: "Речь растёт через ежедневную практику" },
    { key: "te.keep_pace", text: "Сохраним этот темп" },
  ],
  no_access: [
    { key: "na.return_access", text: "Верни доступ — продолжим практику" },
    { key: "na.toward_result", text: "Продолжим идти к результату" },
    { key: "na.coach_waiting", text: "Тренер ждёт, можно вернуться" },
  ],
  payment_failed: [
    { key: "pf.update_payment", text: "Обнови оплату — и продолжаем" },
    { key: "pf.return_access", text: "Верни доступ к практике" },
    { key: "pf.fix_and_continue", text: "Исправим оплату и продолжим" },
  ],
};

export interface MotivationContext {
  derived: DerivedStatus;
  usedSeconds: number;
  /** Last message in the thread is direction='out' from a teacher → student should reply. */
  teacherWaitingForReply: boolean;
}

/**
 * Picks a motivation pool by current state, then a specific entry from that
 * pool while excluding `lastShownKey` (if it was shown today, see
 * pickMotivationForUser). Pure for unit-testing.
 */
export function pickPoolKey(ctx: MotivationContext): keyof typeof MOTIVATION {
  if (ctx.derived.kind === "trial_expired" || ctx.derived.kind === "lapsed") {
    return "no_access";
  }
  if (ctx.derived.kind === "payment_failed") return "payment_failed";
  if (ctx.derived.kind === "frozen") return "no_access";
  if (ctx.derived.kind === "trial_ending") return "trial_ending";

  // Non-locked states (trial, active, renewing_soon) split by today's usage.
  if (ctx.usedSeconds >= 300) return "five";
  if (ctx.usedSeconds >= 60) return "one_to_four";
  return ctx.teacherWaitingForReply ? "zero_teacher_started" : "zero_no_teacher_yet";
}

export function pickFromPool(
  poolKey: keyof typeof MOTIVATION,
  excludeKey: string | null,
): { key: string; text: string } {
  const pool = MOTIVATION[poolKey];
  if (!pool || pool.length === 0) {
    return { key: "noop", text: "" };
  }
  // Exclude only when the previous pick is in the SAME pool — otherwise
  // pool changes (e.g., zero → five at end of day) would lock out a perfectly
  // good first option.
  const filtered = excludeKey
    ? pool.filter((p) => p.key !== excludeKey)
    : pool;
  const choices = filtered.length > 0 ? filtered : pool;
  return choices[Math.floor(Math.random() * choices.length)]!;
}

/**
 * Reads context from the DB, picks a motivation, persists last_motivation_key
 * if it changed for today. Returns the chosen { key, text }. Never throws —
 * a DB hiccup yields the empty-string motivation, which the UI hides.
 */
export async function pickMotivationForUser(input: {
  userId: number;
  tz: string;
  derived: DerivedStatus;
  usedSeconds: number;
}): Promise<{ key: string; text: string }> {
  const sb = getServiceRoleClient();

  // "Teacher waiting for reply" = the last message in the thread is from a
  // teacher AND the student hasn't responded since. We approximate by
  // comparing the most-recent outbound to the most-recent inbound timestamps;
  // outbound > inbound (or only outbound exists) → teacher is waiting.
  const { data: lastOutbound } = await sb
    .from("messages")
    .select("created_at")
    .eq("student_id", input.userId)
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: lastInbound } = await sb
    .from("messages")
    .select("created_at")
    .eq("student_id", input.userId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const teacherWaitingForReply =
    lastOutbound != null &&
    (!lastInbound ||
      new Date(lastOutbound.created_at).getTime() >
        new Date(lastInbound.created_at).getTime());

  const { data: row } = await sb
    .from("subscriptions")
    .select("last_motivation_key, last_motivation_shown_on")
    .eq("user_id", input.userId)
    .maybeSingle();

  const today = localDateInTz(new Date(), input.tz);
  const exclude =
    row?.last_motivation_shown_on === today ? row?.last_motivation_key ?? null : null;

  const poolKey = pickPoolKey({
    derived: input.derived,
    usedSeconds: input.usedSeconds,
    teacherWaitingForReply,
  });
  const picked = pickFromPool(poolKey, exclude);

  if (picked.key !== "noop" && picked.key !== exclude) {
    await sb
      .from("subscriptions")
      .update({
        last_motivation_key: picked.key,
        last_motivation_shown_on: today,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", input.userId);
  }
  return picked;
}
