import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  direction: z.enum(["up", "down"]),
});

/**
 * Swap an onboarding video clip's position with its adjacent neighbor in
 * the same step. "Adjacent" = the closest higher position (down) or lower
 * position (up), even if there's a gap from a previous delete. A no-op
 * returns 200 silently (already at the end / start of its step).
 *
 * The actual swap runs inside `swap_onboarding_video_positions` SQL fn so
 * the (step, position) unique constraint can be deferred for the duration
 * of the two updates.
 */
export async function PATCH(
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
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const { direction } = parsed.data;

  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("onboarding_videos")
    .select("id, step, position")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  }

  // Find the adjacent neighbour in the requested direction.
  const neighborQuery = sb
    .from("onboarding_videos")
    .select("id, position")
    .eq("step", row.step)
    .limit(1);
  const { data: neighbor } = direction === "up"
    ? await neighborQuery
        .lt("position", row.position)
        .order("position", { ascending: false })
        .maybeSingle()
    : await neighborQuery
        .gt("position", row.position)
        .order("position", { ascending: true })
        .maybeSingle();
  if (!neighbor) {
    // Already at the boundary — no-op, not an error.
    return Response.json({ ok: true, moved: false }, { headers: noStoreHeaders });
  }

  const { error } = await sb.rpc("swap_onboarding_video_positions", {
    id_a: row.id,
    id_b: neighbor.id,
  });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  await recordAudit({
    action: "onboarding.video_reorder",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: {
      step: row.step,
      from: row.position,
      to: neighbor.position,
    },
  });
  return Response.json({ ok: true, moved: true }, { headers: noStoreHeaders });
}
