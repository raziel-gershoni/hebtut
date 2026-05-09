import type { NextRequest } from "next/server";
import { addDays, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { localDateInTz } from "@/lib/time";
import { computeRemaining, getUsedForToday } from "@/server/quota";
import { serverEnv } from "@/lib/env";
import { getStatus, type DerivedStatus } from "@/server/subscriptions";
import { computeStreak } from "@/server/streak";
import { pickMotivationForUser } from "@/server/motivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiStatusBase<K extends string> {
  kind: K;
}
type ApiStatus =
  | (ApiStatusBase<"trial"> & { daysLeft: number; endsAtIso: string })
  | (ApiStatusBase<"trial_ending"> & { daysLeft: 0 | 1; endsAtIso: string })
  | (ApiStatusBase<"active"> & { renewsInDays: number; endsAtIso: string })
  | (ApiStatusBase<"renewing_soon"> & { renewsInDays: 0 | 1 | 2; endsAtIso: string })
  | ApiStatusBase<"trial_expired">
  | ApiStatusBase<"lapsed">
  | ApiStatusBase<"payment_failed">
  | (ApiStatusBase<"frozen"> & { untilIso: string });

function toApiStatus(d: DerivedStatus): ApiStatus {
  switch (d.kind) {
    case "trial":
      return { kind: "trial", daysLeft: d.daysLeft, endsAtIso: d.endsAt.toISOString() };
    case "trial_ending":
      return { kind: "trial_ending", daysLeft: d.daysLeft, endsAtIso: d.endsAt.toISOString() };
    case "active":
      return { kind: "active", renewsInDays: d.renewsInDays, endsAtIso: d.endsAt.toISOString() };
    case "renewing_soon":
      return {
        kind: "renewing_soon",
        renewsInDays: d.renewsInDays,
        endsAtIso: d.endsAt.toISOString(),
      };
    case "frozen":
      return { kind: "frozen", untilIso: d.untilDate.toISOString() };
    case "trial_expired":
    case "lapsed":
    case "payment_failed":
      return { kind: d.kind };
  }
}

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
    .select("name, tz")
    .eq("id", user.id)
    .single();
  const tz = row?.tz ?? serverEnv.DEFAULT_TZ;

  const sub = await getStatus(user.id);
  if (!sub) {
    return new Response("no subscription row", { status: 404, headers: noStoreHeaders });
  }

  const used = await getUsedForToday(user.id, tz);
  const dailyQuota = serverEnv.DAILY_QUOTA_SECONDS;
  const remaining = computeRemaining(used, dailyQuota);
  const streakDays = await computeStreak(user.id, tz);
  const motivation = await pickMotivationForUser({
    userId: user.id,
    tz,
    derived: sub.derived,
    usedSeconds: used,
  });

  return Response.json(
    {
      name: row?.name ?? "Ученик",
      status: toApiStatus(sub.derived),
      practice: {
        used_seconds: used,
        remaining_seconds: remaining,
        daily_quota_seconds: dailyQuota,
        reset_at_iso: nextResetIso(tz),
      },
      streak_days: streakDays,
      motivation: { key: motivation.key, text: motivation.text },
      progress_metric: null,
    },
    { headers: noStoreHeaders },
  );
}
