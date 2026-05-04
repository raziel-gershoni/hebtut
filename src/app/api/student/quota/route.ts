import type { NextRequest } from "next/server";
import { addDays, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { localDateInTz } from "@/lib/time";
import { computeRemaining, getUsedForToday } from "@/server/quota";
import { serverEnv } from "@/lib/env";
import { getQuotaChatNotificationsEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * `reset_at_iso`: when does today's quota bucket roll over for THIS student?
 * Quota windows are anchored to local midnight in the student's `tz` (see
 * `commitUsageSplit` in src/server/quota.ts), so we compute tomorrow's
 * midnight in their tz and convert it back to a UTC ISO timestamp the
 * client can render however it wants ("сброс через 7ч 23мин", etc.).
 */
function nextResetIso(tz: string): string {
  const todayLocal = localDateInTz(new Date(), tz);
  const tomorrowLocal = localDateInTz(addDays(parseISO(todayLocal), 1), tz);
  return fromZonedTime(`${tomorrowLocal}T00:00:00`, tz).toISOString();
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("users")
    .select("tz")
    .eq("id", user.id)
    .single();
  const tz = row?.tz ?? serverEnv.DEFAULT_TZ;

  const used = await getUsedForToday(user.id, tz);
  const dailyQuota = serverEnv.DAILY_QUOTA_SECONDS;
  const remaining = computeRemaining(used, dailyQuota);
  const notificationsEnabled = await getQuotaChatNotificationsEnabled();

  return Response.json(
    {
      used_seconds: used,
      remaining_seconds: remaining,
      daily_quota_seconds: dailyQuota,
      reset_at_iso: nextResetIso(tz),
      notifications_enabled: notificationsEnabled,
    },
    { headers: noStoreHeaders },
  );
}
