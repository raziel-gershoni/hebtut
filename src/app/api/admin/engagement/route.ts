import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EngagementSeverity = "red" | "yellow" | "grey";

// NOT exported — Next.js route files may only export handlers/config.
function severityFor(kind: string, tier: string | null): EngagementSeverity {
  if (kind === "tutor_sla" || kind === "ghosting") return "red";
  if (kind === "inactive") return tier === "sliding" ? "yellow" : "red";
  if (kind === "slump") return "yellow";
  return "grey"; // plateau
}

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: flags } = await sb
    .from("student_flags")
    .select(
      "student_id, kind, tier, opened_at, meta, users!inner(name, preferred_name, avatar_file_id)",
    )
    .is("resolved_at", null);

  const rows = (flags ?? []).map((f) => {
    const u = (Array.isArray(f.users) ? f.users[0] : f.users) as {
      name: string | null;
      preferred_name: string | null;
      avatar_file_id: string | null;
    } | null;
    return {
      student_id: f.student_id,
      kind: f.kind,
      tier: f.tier,
      opened_at: f.opened_at,
      meta: f.meta,
      severity: severityFor(f.kind, f.tier),
      name: u?.preferred_name ?? u?.name ?? `#${f.student_id}`,
      has_avatar: !!u?.avatar_file_id,
    };
  });
  // Red first, then yellow, then grey; oldest flags first within a group.
  const order = { red: 0, yellow: 1, grey: 2 } as const;
  rows.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.opened_at.localeCompare(b.opened_at),
  );
  return Response.json({ flags: rows }, { headers: noStoreHeaders });
}
