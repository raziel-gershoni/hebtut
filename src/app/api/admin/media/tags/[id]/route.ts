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
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: tag } = await sb
    .from("media_tags")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();
  if (!tag) return new Response("not found", { status: 404, headers: noStoreHeaders });

  const { count: usage_count } = await sb
    .from("media_library_tag_links")
    .select("tag_id", { count: "exact", head: true })
    .eq("tag_id", id);

  const { error } = await sb.from("media_tags").delete().eq("id", id);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  await recordAudit({
    action: "media.tag_delete",
    actorId: me.id,
    subjectType: "media_tag",
    subjectId: id,
    meta: { name: tag.name, slug: tag.slug, usage_count: usage_count ?? 0 },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
