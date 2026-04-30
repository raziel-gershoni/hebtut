import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface BanRow {
  tg_user_id: number;
  name_snapshot: string | null;
  banned_at: string;
  banned_by: number | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("banned_tg_users")
    .select("tg_user_id, name_snapshot, banned_at, banned_by")
    .order("banned_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  const adminIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r: BanRow) => r.banned_by)
        .filter((id: number | null): id is number => id != null),
    ),
  );
  const adminNames = new Map<number, string>();
  if (adminIds.length > 0) {
    const { data: adminRows } = await sb
      .from("users")
      .select("id, name")
      .in("id", adminIds);
    for (const a of adminRows ?? []) adminNames.set(a.id, a.name ?? `user ${a.id}`);
  }

  const enriched = (rows ?? []).map((r: BanRow) => ({
    tg_user_id: r.tg_user_id,
    name_snapshot: r.name_snapshot,
    banned_at: r.banned_at,
    banned_by_name: r.banned_by != null ? adminNames.get(r.banned_by) ?? null : null,
  }));
  return Response.json({ banned: enriched }, { headers: noStoreHeaders });
}
