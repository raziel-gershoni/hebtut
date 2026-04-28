import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { studentId: string } }) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const studentId = Number(params.studentId);
  if (!Number.isInteger(studentId)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  if (!user.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  const { data: messages, error } = await sb
    .from("messages")
    .select("id, direction, kind, duration, status, created_at")
    .eq("student_id", studentId)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Surface the active claim (if any) so the thread UI can show "X handling".
  const nowIso = new Date().toISOString();
  const { data: claimRow } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", studentId)
    .gt("expires_at", nowIso)
    .maybeSingle();

  let claim: { teacher_id: number; teacher_name: string; expires_at: string } | null = null;
  if (claimRow) {
    const { data: t } = await sb
      .from("users")
      .select("name")
      .eq("id", claimRow.teacher_id)
      .single();
    claim = {
      teacher_id: claimRow.teacher_id,
      teacher_name: t?.name ?? "Преподаватель",
      expires_at: claimRow.expires_at,
    };
  }

  return Response.json({ messages, claim }, { headers: noStoreHeaders });
}
