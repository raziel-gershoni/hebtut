import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

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
      "id, tg_user_id, name, role, is_admin, status, created_at, role_changed_at, avatar_file_id",
    )
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });
  const users = (data ?? []).map((u) => {
    const { avatar_file_id, ...rest } = u;
    return { ...rest, has_avatar: !!avatar_file_id };
  });
  return Response.json({ users }, { headers: noStoreHeaders });
}
