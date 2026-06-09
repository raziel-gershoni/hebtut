import type { NextRequest } from "next/server";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/tutor-work/heartbeat
 *
 * Tutor's Mini App pings here every WORK_HEARTBEAT_CADENCE_SEC while the
 * app is active, focused, and the user is not idle. Server inserts one
 * `active` interval per ping; the merge step at read-time collapses
 * contiguous pings into a single interval.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!user) return new Response("unauthorized", { status: 401, headers: noStoreHeaders });
  if (user.role !== "teacher" && !user.isAdmin) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  const now = new Date();
  const started = new Date(now.getTime() - serverEnv.WORK_HEARTBEAT_CADENCE_SEC * 1000);

  const sb = getServiceRoleClient();
  const { error } = await sb.from("tutor_work_events").insert({
    tutor_id: user.id,
    kind: "active",
    started_at: started.toISOString(),
    ended_at: now.toISOString(),
    ref_id: null,
    source: "heartbeat",
  });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
