import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import type { BillingProvider, CheckoutLink, WebhookEvent } from "./types";

/**
 * Telegram Stars adapter.
 *
 * Flow per period:
 *  1. Mini App calls /api/billing/invoice → server calls
 *     `createInvoiceLink({ currency: 'XTR', prices: [...] })` and returns
 *     the resulting URL.
 *  2. Mini App opens it via `window.Telegram.WebApp.openInvoice(url, cb)`.
 *  3. Telegram sends a `pre_checkout_query` update — handled in /api/webhook.
 *  4. After payment, `successful_payment` arrives as a service-message field;
 *     we decode `invoice_payload`, look up the subscription, and extend.
 *
 * Stars are one-shot — there is no card-on-file recurring. Renewals are
 * surfaced via the cron sending fresh invoice links 24h before period end +
 * day-of (Task 8).
 */

interface InvoicePayload {
  userId: number;
  planId: "monthly";
  bonusDays: number;
  nonce: string;
}

function encodePayload(p: InvoicePayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64");
}

export function decodePayload(raw: string): InvoicePayload | null {
  try {
    const json = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Partial<InvoicePayload>;
    if (
      typeof parsed.userId === "number" &&
      parsed.planId === "monthly" &&
      typeof parsed.bonusDays === "number" &&
      typeof parsed.nonce === "string"
    ) {
      return {
        userId: parsed.userId,
        planId: parsed.planId,
        bonusDays: parsed.bonusDays,
        nonce: parsed.nonce,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const tgStarsProvider: BillingProvider = {
  slug: "tg_stars",

  async createPeriodInvoice(input): Promise<CheckoutLink> {
    const bonusDays = Math.max(0, Math.floor(input.bonusDays ?? 0));
    const periodDays = 30 + bonusDays;
    const payload = encodePayload({
      userId: input.userId,
      planId: input.plan,
      bonusDays,
      nonce: cryptoRandomNonce(),
    });
    const title =
      bonusDays > 0
        ? `Подписка на ${periodDays} дней`
        : "Подписка на месяц";
    const description =
      bonusDays > 0
        ? `30 дней практики + ${bonusDays} бонусных от рефералов.`
        : "30 дней практики с тренером.";
    const url = await getBot().api.createInvoiceLink(
      title,
      description,
      payload,
      // provider_token is empty for Stars — currency XTR signals Stars.
      "",
      "XTR",
      [{ label: title, amount: serverEnv.MONTHLY_SUBSCRIPTION_STARS }],
    );
    return { url, invoice_payload: payload };
  },

  async verifyAndParseWebhook(update): Promise<WebhookEvent | null> {
    // Webhooks from grammY are routed via filtered handlers in /api/webhook;
    // this method exists for the abstract interface but isn't called for
    // the Stars path. Stripe/TG-Payments adapters would parse here instead.
    void update;
    return null;
  },
};

function cryptoRandomNonce(): string {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
