import type { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { studentId: string } }) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) {
    return new Response("forbidden", { status: 403 });
  }
  const studentId = Number(params.studentId);
  if (!Number.isInteger(studentId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  if (user.role !== "admin") {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403 });
  }

  const { data, error } = await sb
    .from("messages")
    .select("id, direction, kind, duration, status, created_at")
    .eq("student_id", studentId)
    .in("status", ["pending", "claimed", "answered", "expired"])
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ messages: data });
}
