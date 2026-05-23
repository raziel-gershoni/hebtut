import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "media-library";

/**
 * Delete a single onboarding video clip by id. Drops the row + the storage
 * object. We DO NOT renumber surviving clips — the send helper orders by
 * position regardless of gaps, so leaving a hole is the correct behaviour.
 *
 * Note: any queued `video_sequence_next` timers carrying this position in
 * their `meta` payload will detect the gap at dispatch time and either
 * skip to the next existing position or end the sequence — see
 * dispatchVideoSequenceNext in /api/cron/onboarding/route.ts.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("onboarding_videos")
    .select("id, step, position, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return Response.json({ ok: true }, { headers: noStoreHeaders });
  }
  await sb.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await sb.from("onboarding_videos").delete().eq("id", id);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  await recordAudit({
    action: "onboarding.video_delete",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: { id: row.id, step: row.step, position: row.position },
  });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
