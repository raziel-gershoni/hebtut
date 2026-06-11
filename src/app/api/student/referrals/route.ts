import type { NextRequest } from "next/server";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";
import { buildReferralUrl } from "@/server/invites";
import { getReferralsEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/student/referrals
 * Returns the student's personal share link, the count of attributed signups,
 * and the count of those who've already paid (so the UI can split "пришли"
 * vs "оплатили"). Token comes from users.referral_token (backfilled per
 * 20260509000002 migration; lazy-created on read for users that somehow
 * don't have one yet).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  if (!(await getReferralsEnabled())) {
    return Response.json({ enabled: false }, { headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("users")
    .select("referral_token")
    .eq("id", user.id)
    .single();

  let token = row?.referral_token ?? null;
  if (!token) {
    // Lazy-mint: a student created between migrations or via a code path
    // that bypassed the backfill gets a token now.
    token = mintToken();
    await sb.from("users").update({ referral_token: token }).eq("id", user.id);
  }

  // Attributed referees: subscriptions rows pointing back at me.
  const { data: referees } = await sb
    .from("subscriptions")
    .select("user_id, current_period_starts_at")
    .eq("referred_by_user_id", user.id);

  const attributed = referees?.length ?? 0;
  const paid = (referees ?? []).filter((r) => r.current_period_starts_at != null).length;

  return Response.json(
    {
      token,
      url: buildReferralUrl(serverEnv.TELEGRAM_BOT_USERNAME, token),
      attributed_count: attributed,
      paid_count: paid,
    },
    { headers: noStoreHeaders },
  );
}

function mintToken(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "_")
    .replace(/\//g, "-")
    .replace(/=+$/, "");
}
