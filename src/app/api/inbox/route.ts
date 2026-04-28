import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();

  const { data: links } = await sb
    .from("student_teachers")
    .select("student_id")
    .eq("teacher_id", user.id);
  const studentIds = (links ?? []).map((l) => l.student_id);
  if (!studentIds.length) return Response.json({ messages: [] });

  const { data: messages, error } = await sb
    .from("messages")
    .select(
      "id, student_id, direction, kind, duration, status, claimed_by_teacher_id, created_at, users:student_id(name)",
    )
    .in("student_id", studentIds)
    .eq("direction", "in")
    .in("status", ["pending", "claimed", "answered"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ messages }, { headers: noStoreHeaders });
}
