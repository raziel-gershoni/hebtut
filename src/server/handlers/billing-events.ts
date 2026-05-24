import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { decodePayload } from "@/server/billing/tg-stars";
import { applySuccessfulPayment } from "@/server/subscriptions";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";

/**
 * `pre_checkout_query` arrives just before the user authorizes payment in
 * Stars. We have ~10s to answer; failing to answer cancels the transaction.
 * Always answer ok=true here — payload validation happens in the webhook
 * handler post-payment, and we'd rather refund than block a paying user.
 */
export async function handlePreCheckoutQuery(ctx: Context): Promise<void> {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.warn("pre_checkout_query answer failed", { reason: (e as Error).message });
  }
}

/**
 * `successful_payment` is a service-message field that arrives after the
 * user pays. Decode the invoice_payload, find the subscription, extend the
 * period, and DM a confirmation. Idempotent via providerPaymentId — the
 * audit_events row prevents double-processing if Telegram redelivers.
 */
export async function handleSuccessfulPayment(ctx: Context): Promise<void> {
  const sp = ctx.message?.successful_payment;
  if (!sp) return;
  const payload = decodePayload(sp.invoice_payload);
  if (!payload) {
    console.warn("successful_payment: undecodable payload", {
      payload: sp.invoice_payload.slice(0, 24),
    });
    return;
  }

  const sb = getServiceRoleClient();
  const { data: existing } = await sb
    .from("audit_events")
    .select("id")
    .eq("action", "billing.payment_succeeded")
    .eq("actor_id", payload.userId)
    .contains("meta", { provider_payment_id: sp.telegram_payment_charge_id })
    .maybeSingle();
  if (existing) {
    // Telegram redelivered an already-processed payment — ignore.
    return;
  }

  const periodDays = 30 + (payload.bonusDays ?? 0);
  const result = await applySuccessfulPayment({
    userId: payload.userId,
    periodDays,
    provider: "tg_stars",
    providerPaymentId: sp.telegram_payment_charge_id,
  });
  if (!result) {
    await recordAudit({
      action: "billing.payment_orphan",
      actorId: payload.userId,
      meta: { reason: "no subscription row", payload },
    });
    return;
  }

  // Confirmation DM — single message, no spam. Format the new end-date in
  // a Russian-friendly DD.MM.
  const endDate = result.refereeNewEndsAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  try {
    await ctx.reply(ru.bot.subscription.paymentSucceeded(endDate));
  } catch (e) {
    console.warn("payment confirm DM failed", { reason: (e as Error).message });
  }

  if (result.referrerCreditedDays > 0) {
    // DM the referrer too — needs their tg_chat_id from users.
    const { data: refereeRow } = await sb
      .from("subscriptions")
      .select("referred_by_user_id")
      .eq("user_id", payload.userId)
      .single();
    const referrerId = refereeRow?.referred_by_user_id;
    if (referrerId) {
      const { data: refUser } = await sb
        .from("users")
        .select("tg_chat_id")
        .eq("id", referrerId)
        .maybeSingle();
      if (refUser?.tg_chat_id) {
        try {
          await ctx.api.sendMessage(
            refUser.tg_chat_id,
            ru.bot.subscription.referralCreditApplied(result.referrerCreditedDays),
          );
        } catch (e) {
          console.warn("referrer DM failed", { reason: (e as Error).message });
        }
      }
    }
  }
}
