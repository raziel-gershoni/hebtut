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
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  const { data: links } = await sb
    .from("student_teachers")
    .select("student_id")
    .eq("teacher_id", user.id);
  const studentIds = (links ?? []).map((l) => l.student_id);
  if (!studentIds.length) {
    return Response.json({ messages: [], claims: [] }, { headers: noStoreHeaders });
  }

  const { data: messages, error } = await sb
    .from("messages")
    .select(
      "id, student_id, direction, kind, duration, status, created_at, users:student_id(name)",
    )
    .in("student_id", studentIds)
    .eq("direction", "in")
    .in("status", ["pending", "answered"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Active claims for these students (so the UI can show "T handling").
  const nowIso = new Date().toISOString();
  const { data: rawClaims } = await sb
    .from("claims")
    .select("student_id, teacher_id, expires_at")
    .in("student_id", studentIds)
    .gt("expires_at", nowIso);

  // Resolve handler names for the claims (small N — typically 0-1).
  const handlerIds = Array.from(new Set((rawClaims ?? []).map((c) => c.teacher_id)));
  const { data: handlers } = handlerIds.length
    ? await sb.from("users").select("id, name").in("id", handlerIds)
    : { data: [] as { id: number; name: string | null }[] };
  const handlerById = new Map(
    (handlers ?? []).map((h) => [h.id, h.name ?? "Преподаватель"]),
  );

  const claims = (rawClaims ?? []).map((c) => ({
    student_id: c.student_id,
    teacher_id: c.teacher_id,
    teacher_name: handlerById.get(c.teacher_id) ?? "Преподаватель",
    expires_at: c.expires_at,
  }));

  return Response.json({ messages, claims }, { headers: noStoreHeaders });
}
