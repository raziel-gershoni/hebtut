import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  status: z.enum(["active", "suspended"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400, headers: noStoreHeaders });
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("users")
    .update({ status: parsed.data.status })
    .eq("id", targetId);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
