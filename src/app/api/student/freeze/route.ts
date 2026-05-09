import type { NextRequest } from "next/server";
import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { localDateInTz } from "@/lib/time";
import {
  FREEZE_BUDGET_DAYS_PER_MONTH,
  lazyResetFreezeBudget,
} from "@/server/subscriptions";
import { recordAudit } from "@/server/audit";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/student/freeze
 * Returns the user's remaining freeze budget for this calendar month and the
 * current frozen window if any (for the page to render the right state).
 *
 * POST /api/student/freeze { days: 1|2|3 }
 * Schedules a freeze starting tomorrow midnight (in the student's tz). The
 * subscription's current_period_ends_at is extended by `days` immediately so
 * the user doesn't lose paid days; status flips to 'frozen' on the same call.
 * frozen_until = tomorrow + days at 00:00 user-local. The hourly cron flips
 * status back to 'active' once frozen_until passes.
 *
 * Restrictions:
 *  - Only available to active subscribers (not trial / not lapsed / not
 *    payment_failed). The button is hidden in those states client-side; the
 *    API is the second line of defence.
 *  - Cannot exceed the per-month budget. Multiple sub-3-day freezes consume
 *    the budget the same as one 3-day block.
 */

const Body = z.object({
  days: z.number().int().min(1).max(3),
});

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const remaining = await lazyResetFreezeBudget(user.id);
  const { data: row } = await sb
    .from("subscriptions")
    .select("status, frozen_until, current_period_ends_at, response_window_tz")
    .eq("user_id", user.id)
    .maybeSingle();
  return Response.json(
    {
      remaining_days: remaining,
      budget_days: FREEZE_BUDGET_DAYS_PER_MONTH,
      status: row?.status ?? null,
      frozen_until_iso: row?.frozen_until ?? null,
      current_period_ends_at_iso: row?.current_period_ends_at ?? null,
    },
    { headers: noStoreHeaders },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const days = parsed.data.days;

  const sb = getServiceRoleClient();
  const { data: userRow } = await sb
    .from("users")
    .select("tz, tg_chat_id")
    .eq("id", user.id)
    .single();
  const tz = userRow?.tz ?? serverEnv.DEFAULT_TZ;

  const remaining = await lazyResetFreezeBudget(user.id);
  if (days > remaining) {
    return Response.json(
      { ok: false, error: "budget_exceeded", remaining_days: remaining },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const { data: sub } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub) {
    return new Response("no subscription", { status: 404, headers: noStoreHeaders });
  }
  if (sub.status !== "active") {
    // Only 'active' subscribers can freeze. 'renewing_soon' is a derived
    // status (computed in deriveStatus) — the stored row says 'active' for
    // those users, so they fall through. trial / lapsed / frozen /
    // payment_failed are all rejected here.
    return Response.json(
      { ok: false, error: "not_active" },
      { status: 400, headers: noStoreHeaders },
    );
  }
  if (!sub.current_period_ends_at) {
    return Response.json(
      { ok: false, error: "no_period" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  // Compute tomorrow midnight in the student's tz, in UTC.
  const todayLocal = localDateInTz(new Date(), tz);
  const tomorrowLocal = localDateInTz(
    addDays(new Date(`${todayLocal}T00:00:00Z`), 1),
    tz,
  );
  const tomorrowMidnightUtc = fromZonedTime(`${tomorrowLocal}T00:00:00`, tz);
  const frozenUntil = new Date(tomorrowMidnightUtc.getTime() + days * 86_400_000);

  // Extend the period now — the user pays for X days; freezing N pushes
  // the end forward by N so they get those days back when the freeze ends.
  const newPeriodEnd = new Date(
    new Date(sub.current_period_ends_at).getTime() + days * 86_400_000,
  );
  const now = new Date();

  const { error } = await sb
    .from("subscriptions")
    .update({
      status: "frozen",
      frozen_until: frozenUntil.toISOString(),
      current_period_ends_at: newPeriodEnd.toISOString(),
      next_renewal_at: newPeriodEnd.toISOString(),
      freeze_days_used_in_period: (sub.freeze_days_used_in_period ?? 0) + days,
      updated_at: now.toISOString(),
    })
    .eq("user_id", user.id);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "subscription.freeze_activated",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: {
      days,
      starts_at: tomorrowMidnightUtc.toISOString(),
      frozen_until: frozenUntil.toISOString(),
      new_period_ends_at: newPeriodEnd.toISOString(),
    },
  });

  // DM the user — preserves the spec's wording so they have a chat-side record.
  if (userRow?.tg_chat_id) {
    try {
      await getBot().api.sendMessage(userRow.tg_chat_id, ru.freezeActivated(days));
    } catch (e) {
      console.warn("freeze DM failed", { reason: (e as Error).message });
    }
  }

  return Response.json(
    {
      ok: true,
      frozen_until_iso: frozenUntil.toISOString(),
      new_period_ends_at_iso: newPeriodEnd.toISOString(),
      remaining_days: remaining - days,
    },
    { headers: noStoreHeaders },
  );
}
