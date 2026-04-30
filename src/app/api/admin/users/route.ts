import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select(
      "id, tg_user_id, tg_username, name, display_handle, display_emoji, role, is_admin, status, created_at, role_changed_at, avatar_file_id",
    )
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });

  // Lazy backfill: legacy rows have NULL display_handle. Compute, write back
  // (fire-and-forget so the response isn't blocked), and fill the response too.
  const backfills: { id: number; handle: string; emoji: string }[] = [];
  const enriched = (data ?? []).map((u) => {
    let handle = u.display_handle;
    let emoji = u.display_emoji;
    if (!handle || !emoji) {
      const h = userHandle(u.tg_user_id);
      handle = h.handle;
      emoji = h.emoji;
      backfills.push({ id: u.id, handle, emoji });
    }
    const { avatar_file_id, ...rest } = u;
    return {
      ...rest,
      display_handle: handle,
      display_emoji: emoji,
      has_avatar: !!avatar_file_id,
    };
  });
  if (backfills.length > 0) {
    void Promise.all(
      backfills.map((b) =>
        sb
          .from("users")
          .update({ display_handle: b.handle, display_emoji: b.emoji })
          .eq("id", b.id),
      ),
    ).catch((e) => console.warn("display_handle backfill failed", e));
  }

  return Response.json({ users: enriched }, { headers: noStoreHeaders });
}
