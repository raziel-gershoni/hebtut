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

  const { data: rawMessages, error } = await sb
    .from("messages")
    .select(
      "id, direction, kind, duration, status, reply_to_id, created_at, teacher_id",
    )
    .eq("student_id", studentId)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Resolve every distinct teacher referenced by an outbound row in one shot,
  // so the client can render per-bubble avatars without N round-trips.
  const teacherIds = Array.from(
    new Set(
      (rawMessages ?? [])
        .map((m) => m.teacher_id)
        .filter((id): id is number => id != null),
    ),
  );
  const teachersById = new Map<number, { id: number; name: string | null; has_avatar: boolean }>();
  if (teacherIds.length > 0) {
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, name, avatar_file_id")
      .in("id", teacherIds);
    for (const t of teacherRows ?? []) {
      teachersById.set(t.id, {
        id: t.id,
        name: t.name,
        has_avatar: !!t.avatar_file_id,
      });
    }
  }
  const messages = (rawMessages ?? []).map((m) => ({
    id: m.id,
    direction: m.direction,
    kind: m.kind,
    duration: m.duration,
    status: m.status,
    reply_to_id: m.reply_to_id,
    created_at: m.created_at,
    teacher_id: m.teacher_id,
    teacher: m.teacher_id != null ? teachersById.get(m.teacher_id) ?? null : null,
  }));

  const { data: studentRow } = await sb
    .from("users")
    .select("id, name, avatar_file_id")
    .eq("id", studentId)
    .single();
  const student = studentRow
    ? {
        id: studentRow.id,
        name: studentRow.name,
        has_avatar: !!studentRow.avatar_file_id,
      }
    : null;

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
      teacher_name: t?.name ?? "Тренер",
      expires_at: claimRow.expires_at,
    };
  }

  return Response.json({ messages, claim, student }, { headers: noStoreHeaders });
}
