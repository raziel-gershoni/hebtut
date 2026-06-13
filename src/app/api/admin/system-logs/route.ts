import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500);
  let q = getServiceRoleClient()
    .from("system_logs")
    .select("id, created_at, level, source, message, meta")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (source) q = q.eq("source", source);
  const { data, error } = await q;
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  return Response.json({ logs: data ?? [] }, { headers: noStoreHeaders });
}
