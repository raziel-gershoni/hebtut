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
  { params }: { params: { tgUserId: string } },
) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const tgUserId = Number(params.tgUserId);
  if (!Number.isInteger(tgUserId)) return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("banned_tg_users")
    .delete()
    .eq("tg_user_id", tgUserId);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  await recordAudit({
    action: "admin.user_unban",
    actorId: user.id,
    subjectType: "banlist",
    subjectId: tgUserId,
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
