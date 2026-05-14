import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_NAME_LENGTH = 50;

/**
 * PATCH /api/admin/users/[id]/preferred-name
 *
 * Body: { preferred_name: string | null }
 *
 * Writes users.preferred_name (NULL clears, peer-facing surfaces fall back
 * through to users.name from Telegram). Validation matches the onboarding
 * name-input handler so an admin edit and a student self-edit produce the
 * same shape: trimmed, ≤50 chars, single-line (whitespace collapsed).
 *
 * Admin-only, audited as admin.preferred_name_change with from/to.
 */

const Body = z.object({
  preferred_name: z.union([z.string(), z.null()]),
});

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

  let next: string | null;
  if (parsed.data.preferred_name === null) {
    next = null;
  } else {
    const trimmed = parsed.data.preferred_name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
      return new Response("invalid length", {
        status: 400,
        headers: noStoreHeaders,
      });
    }
    next = trimmed.replace(/\s+/g, " ");
  }

  const sb = getServiceRoleClient();
  const { data: prior } = await sb
    .from("users")
    .select("preferred_name")
    .eq("id", targetId)
    .maybeSingle();
  if (!prior) {
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  }

  const { error } = await sb
    .from("users")
    .update({ preferred_name: next })
    .eq("id", targetId);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "admin.preferred_name_change",
    actorId: user.id,
    subjectType: "user",
    subjectId: targetId,
    meta: { from: prior.preferred_name, to: next },
  });

  return Response.json({ ok: true, preferred_name: next }, { headers: noStoreHeaders });
}
