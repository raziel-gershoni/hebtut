import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";
import { tgStarsProvider } from "@/server/billing/tg-stars";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hourly subscription tick. Runs three lazy state transitions and two
 * reminder DM passes per call. Each operation is bounded by an indexed
 * `where` clause so the query cost stays flat as the user base grows.
 *
 *  1. trial → trial_expired when trial_ends_at < now
 *  2. active → lapsed when current_period_ends_at < now
 *  3. frozen → active when frozen_until < now (period_ends already extended at freeze time)
 *  4. 24h-pre-end reminder DM (one-shot per period via last_renewal_reminder_sent_at)
 *  5. day-of-end reminder DM (separate dedup window)
 */
async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Transition 1: trial → trial_expired.
  const { data: trialExpired } = await sb
    .from("subscriptions")
    .update({ status: "trial_expired", updated_at: nowIso })
    .eq("status", "trial")
    .lt("trial_ends_at", nowIso)
    .select("user_id");
  for (const row of trialExpired ?? []) {
    await recordAudit({
      action: "subscription.trial_expired",
      actorId: null,
      subjectType: "user",
      subjectId: row.user_id,
    });
  }

  // Transition 2: active → lapsed.
  const { data: lapsed } = await sb
    .from("subscriptions")
    .update({ status: "lapsed", updated_at: nowIso })
    .eq("status", "active")
    .lt("current_period_ends_at", nowIso)
    .select("user_id");
  for (const row of lapsed ?? []) {
    await recordAudit({
      action: "subscription.lapsed",
      actorId: null,
      subjectType: "user",
      subjectId: row.user_id,
    });
  }

  // Transition 3: frozen → active. Period_ends_at was already extended when
  // the freeze was created (see /api/student/freeze), so we just flip status.
  const { data: thawed } = await sb
    .from("subscriptions")
    .update({ status: "active", updated_at: nowIso })
    .eq("status", "frozen")
    .lt("frozen_until", nowIso)
    .select("user_id");
  for (const row of thawed ?? []) {
    await recordAudit({
      action: "subscription.thawed",
      actorId: null,
      subjectType: "user",
      subjectId: row.user_id,
    });
  }

  // Reminder window: anything ending in [now, now + 25h]. Filter in JS to
  // distinguish "24h pre" from "day of" using last_renewal_reminder_sent_at.
  const upperIso = new Date(now.getTime() + 25 * HOUR_MS).toISOString();
  const { data: ending } = await sb
    .from("subscriptions")
    .select("*")
    .or(
      `and(status.eq.active,current_period_ends_at.gte.${nowIso},current_period_ends_at.lte.${upperIso}),and(status.eq.trial,trial_ends_at.gte.${nowIso},trial_ends_at.lte.${upperIso})`,
    );

  let remindersSent = 0;
  for (const row of (ending ?? []) as SubscriptionRow[]) {
    const endsAt =
      row.status === "trial"
        ? new Date(row.trial_ends_at)
        : row.current_period_ends_at
          ? new Date(row.current_period_ends_at)
          : null;
    if (!endsAt) continue;
    const msToEnd = endsAt.getTime() - now.getTime();
    const lastReminder = row.last_renewal_reminder_sent_at
      ? new Date(row.last_renewal_reminder_sent_at).getTime()
      : 0;

    // Window classification: < 6h → "day-of", else "24h-pre".
    const dayOf = msToEnd < 6 * HOUR_MS;
    // Dedup: don't re-send within the same window. 24h-pre fires at most once
    // per period; day-of can re-fire if user lingers past the 6h mark.
    const dedupWindowMs = dayOf ? 4 * HOUR_MS : DAY_MS;
    if (lastReminder > now.getTime() - dedupWindowMs) continue;

    // Pull tg_chat_id from users.
    const { data: user } = await sb
      .from("users")
      .select("tg_chat_id")
      .eq("id", row.user_id)
      .maybeSingle();
    if (!user?.tg_chat_id) continue;

    // Build the invoice on demand. Failure here shouldn't block the others.
    let invoiceUrl: string | null = null;
    try {
      const link = await tgStarsProvider.createPeriodInvoice({
        userId: row.user_id,
        plan: "monthly",
      });
      invoiceUrl = link.url;
    } catch (e) {
      console.warn("renewal invoice creation failed", {
        user_id: row.user_id,
        reason: (e as Error).message,
      });
      continue;
    }

    const text = dayOf
      ? row.status === "trial"
        ? ru.trialEndsToday
        : ru.subscriptionEndsToday
      : row.status === "trial"
        ? ru.trialEndsTomorrow
        : ru.subscriptionEndsTomorrow;

    try {
      await getBot().api.sendMessage(user.tg_chat_id, text, {
        reply_markup: {
          inline_keyboard: [[{ text: ru.lockedTemplateButton, url: invoiceUrl }]],
        },
      });
      remindersSent++;
      await sb
        .from("subscriptions")
        .update({
          last_renewal_reminder_sent_at: nowIso,
          updated_at: nowIso,
        })
        .eq("user_id", row.user_id);
    } catch (e) {
      console.warn("renewal reminder DM failed", {
        user_id: row.user_id,
        reason: (e as Error).message,
      });
    }
  }

  return Response.json({
    trial_expired: trialExpired?.length ?? 0,
    lapsed: lapsed?.length ?? 0,
    thawed: thawed?.length ?? 0,
    reminders_sent: remindersSent,
  });
}

export { handler as GET, handler as POST };
