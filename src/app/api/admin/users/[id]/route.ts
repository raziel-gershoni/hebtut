import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Hard-delete a user row plus all data referencing them. The optional
 * `?ban=1` query param additionally inserts the user's tg_user_id into
 * `banned_tg_users` so future /start clicks from that TG account are
 * silently ignored.
 *
 * The cascade itself runs inside a Postgres function (delete_user_cascade)
 * so all child-row deletes happen in one transaction.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const url = new URL(req.url);
  const banAlso = url.searchParams.get("ban") === "1";

  const sb = getServiceRoleClient();

  // Snapshot tg_user_id and name before delete — needed for the ban list row.
  const { data: target } = await sb
    .from("users")
    .select("tg_user_id, name")
    .eq("id", targetId)
    .single();
  if (!target) return new Response("not found", { status: 404, headers: noStoreHeaders });

  if (banAlso) {
    // Insert the blacklist row first; if the cascade delete fails we'd rather
    // have the ban already in place than allow a re-register window.
    await sb
      .from("banned_tg_users")
      .upsert(
        {
          tg_user_id: target.tg_user_id,
          name_snapshot: target.name,
          banned_by: user.id,
        },
        { onConflict: "tg_user_id" },
      );
  }

  const { error } = await sb.rpc("delete_user_cascade", { target_id: targetId });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
