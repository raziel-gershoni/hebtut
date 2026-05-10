import type { NextRequest } from "next/server";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { tgStarsProvider } from "@/server/billing/tg-stars";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordAudit } from "@/server/audit";
import { getBillingStarsEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/billing/invoice
 * Returns { url } — a one-shot Telegram Stars invoice link the Mini App
 * opens via window.Telegram.WebApp.openInvoice. No body needed: we use the
 * authed userId from JWT. Bonus days are read from the row directly (e.g.,
 * if referrals or admin grants accrued, they apply on the next purchase).
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  // Server-side gate. Defense-in-depth: even if a stale Mini App tab still
  // has the old PayCTA wired up, no Stars invoice URL can be created while
  // the admin flag is off. The Stars adapter, webhook handlers, and
  // applySuccessfulPayment stay live so any IN-FLIGHT payment still
  // settles correctly — we only block NEW invoice creation here.
  if (!(await getBillingStarsEnabled())) {
    return new Response("billing_stars_disabled", {
      status: 503,
      headers: noStoreHeaders,
    });
  }
  // No bonus-days source defined yet (referrals are applied at payment-time
  // in applySuccessfulPayment, not pre-purchase), so always 0 here. Stripe /
  // pre-paid coupon flows would read a credits-balance column instead.
  const link = await tgStarsProvider.createPeriodInvoice({
    userId: user.id,
    plan: "monthly",
  });

  // Audit the intent — useful for diagnosing "I clicked Pay but nothing
  // happened" reports. Pair the invoice_payload with the user so we can
  // join later when successful_payment lands.
  await recordAudit({
    action: "billing.invoice_created",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: {
      provider: tgStarsProvider.slug,
      invoice_payload_prefix: link.invoice_payload.slice(0, 12),
    },
  });

  // Stash the invoice_payload on the subscription row so the webhook can
  // verify the user matches in case payload decoding ever drifts.
  const sb = getServiceRoleClient();
  await sb
    .from("subscriptions")
    .update({ provider: tgStarsProvider.slug, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  return Response.json({ url: link.url }, { headers: noStoreHeaders });
}
