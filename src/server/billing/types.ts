/**
 * Provider-agnostic seam for paid subscriptions. The home-card PayCTA, the
 * `/api/billing/invoice` route, and the subscription webhook all flow through
 * this interface — swapping Telegram Stars for Stripe / TG Payments later is
 * one new file in src/server/billing/.
 *
 * Today's only implementation is `tg-stars.ts`. Stars are one-shot (no
 * card-on-file recurring), which is why `createPeriodInvoice` is per-period
 * rather than "subscribe." Renewals are surfaced via the hourly cron sending
 * a fresh invoice link 24h before period end + day-of.
 */

export interface CheckoutLink {
  /** URL to open via window.Telegram.WebApp.openInvoice (or in-browser fallback). */
  url: string;
  /**
   * Provider-opaque correlation token. Webhook handlers use this to match
   * a successful_payment back to the user + plan. Encoded such that the
   * provider preserves it round-trip; for TG Stars we base64-encode a
   * { userId, planId, nonce } JSON.
   */
  invoice_payload: string;
}

export type WebhookEvent =
  | {
      kind: "payment_succeeded";
      userId: number;
      periodDays: number;
      providerPaymentId: string;
    }
  | { kind: "payment_failed"; userId: number; reason: string };

export interface BillingProvider {
  /** Slug identifying which adapter — written into subscriptions.provider for diagnostics. */
  readonly slug: "tg_stars" | "tg_payments" | "stripe";

  /**
   * One-time invoice for a 30-day period extension. `bonusDays` lets the
   * referral flow tack extra days onto a single invoice without reaching
   * inside the adapter.
   */
  createPeriodInvoice(input: {
    userId: number;
    plan: "monthly";
    bonusDays?: number;
  }): Promise<CheckoutLink>;

  /**
   * Decode an inbound webhook update from this provider. Returns null if
   * the request is from a different provider — the dispatcher tries each
   * registered adapter in order. Never throws on bad payloads; returns null.
   */
  verifyAndParseWebhook(update: unknown): Promise<WebhookEvent | null>;
}
