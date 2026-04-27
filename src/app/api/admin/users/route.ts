import type { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select("id, tg_user_id, name, role, status, created_at, role_changed_at")
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ users: data });
}
