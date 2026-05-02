import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("teacher_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .is("revoked_at", null);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  await recordAudit({
    action: "admin.invite_revoke",
    actorId: user.id,
    subjectType: "invite",
    subjectId: id,
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
