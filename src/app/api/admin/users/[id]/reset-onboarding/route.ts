import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/admin/users/[id]/reset-onboarding
 *
 * Puts a student back at the welcome screen so their next /start triggers
 * Step 1 fresh. Three updates in sequence:
 *
 * 1. subscriptions row → state = 'welcome', anchor timestamps cleared.
 * 2. Pending onboarding_timers → cancelled (so a 2h/24h nudge scheduled
 *    against the OLD state can't fire after the reset).
 * 3. Optional: clear preferred_name so the "как мне к тебе обращаться?"
 *    step asks again. We don't clear `name` (it gets re-synced from TG
 *    on /start anyway).
 *
 * Admin-only. No body needed; the URL identifies the target user.
 * Refuses non-students — pending/teacher accounts don't have onboarding
 * to reset.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  const { data: target } = await sb
    .from("users")
    .select("id, role, preferred_name")
    .eq("id", targetId)
    .maybeSingle();
  if (!target) {
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  }
  if (target.role !== "student") {
    return new Response("not a student", { status: 400, headers: noStoreHeaders });
  }

  const { data: priorSub } = await sb
    .from("subscriptions")
    .select("onboarding_state")
    .eq("user_id", targetId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  // Upsert so we work even for legacy students missing the subscription
  // row (createStudent now provisions one, but older rows may not have).
  await sb.from("subscriptions").upsert(
    {
      user_id: targetId,
      onboarding_state: "welcome",
      onboarding_state_entered_at: nowIso,
      onboarding_first_msg_at: null,
      onboarding_first_reply_at: null,
      onboarding_last_active_at: null,
      onboarding_day1_limit_msg_sent_at: null,
      onboarding_last_pause_nudge_at: null,
      unassigned_ack_sent_at: null,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  // Soft-cancel pending timers so they don't fire against the old state.
  await sb
    .from("onboarding_timers")
    .update({ cancelled_at: nowIso })
    .eq("student_id", targetId)
    .is("fired_at", null)
    .is("cancelled_at", null);

  await sb.from("users").update({ preferred_name: null }).eq("id", targetId);

  await recordAudit({
    action: "admin.onboarding_reset",
    actorId: me.id,
    subjectType: "user",
    subjectId: targetId,
    meta: {
      previous_state: priorSub?.onboarding_state ?? null,
      cleared_preferred_name: target.preferred_name,
    },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
