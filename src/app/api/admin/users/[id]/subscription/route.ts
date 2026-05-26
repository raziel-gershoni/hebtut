import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import {
  grantSubscriptionDays,
  resetTrialForUser,
  lapseSubscription,
} from "@/server/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * PATCH /api/admin/users/[id]/subscription
 *
 * Manual admin operations on a student's subscription:
 *   { action: "grant_days"; days: 1..3650 } — extends current_period_ends_at,
 *     anchored on existing future end if active/trial-with-time, else now.
 *   { action: "reset_trial" }              — fresh 2-day trial from now.
 *   { action: "lapse" }                    — close immediately.
 *
 * None of these trigger referral credits — that's only for actual paid
 * conversions in applySuccessfulPayment.
 */
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("grant_days"),
    days: z.number().int().min(1).max(3650),
  }),
  z.object({ action: z.literal("reset_trial") }),
  z.object({ action: z.literal("lapse") }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }

  const action = parsed.data;
  if (action.action === "grant_days") {
    const result = await grantSubscriptionDays({
      userId: targetId,
      days: action.days,
      byAdminId: user.id,
    });
    if (!result) {
      return new Response("no subscription row", {
        status: 404,
        headers: noStoreHeaders,
      });
    }
    return Response.json(
      { ok: true, new_period_ends_at: result.newPeriodEnd.toISOString() },
      { headers: noStoreHeaders },
    );
  }
  if (action.action === "reset_trial") {
    const result = await resetTrialForUser({
      userId: targetId,
      byAdminId: user.id,
    });
    if (!result) {
      return new Response("no subscription row", {
        status: 404,
        headers: noStoreHeaders,
      });
    }
    return Response.json(
      { ok: true, trial_ends_at: result.trialEnd.toISOString() },
      { headers: noStoreHeaders },
    );
  }
  // lapse
  const ok = await lapseSubscription({
    userId: targetId,
    byAdminId: user.id,
  });
  if (!ok) {
    return new Response("no subscription row", {
      status: 404,
      headers: noStoreHeaders,
    });
  }
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
