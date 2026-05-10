import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function resolveHandle(
  row: { tg_user_id: number; display_handle: string | null; display_emoji: string | null } | undefined | null,
): { handle: string; emoji: string } {
  if (row?.display_handle && row.display_emoji) {
    return { handle: row.display_handle, emoji: row.display_emoji };
  }
  const fallbackTgId = row?.tg_user_id ?? 0;
  const h = userHandle(fallbackTgId);
  return { handle: h.handle, emoji: h.emoji };
}

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
      "id, direction, kind, duration, status, reply_to_id, created_at, teacher_id, text_content",
    )
    .eq("student_id", studentId)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Resolve every distinct teacher referenced by an outbound row in one shot,
  // so the client can render per-bubble anonymous avatars without N round-trips.
  const teacherIds = Array.from(
    new Set(
      (rawMessages ?? [])
        .map((m) => m.teacher_id)
        .filter((id): id is number => id != null),
    ),
  );
  const teachersById = new Map<number, { id: number; handle: string; emoji: string }>();
  if (teacherIds.length > 0) {
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, tg_user_id, display_handle, display_emoji")
      .in("id", teacherIds);
    for (const t of teacherRows ?? []) {
      const h = resolveHandle(t);
      teachersById.set(t.id, { id: t.id, handle: h.handle, emoji: h.emoji });
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
    text_content: m.text_content ?? null,
  }));

  const { data: studentRow } = await sb
    .from("users")
    .select("id, tg_user_id, display_handle, display_emoji")
    .eq("id", studentId)
    .single();
  const studentHandle = resolveHandle(studentRow);
  const student = studentRow
    ? {
        id: studentRow.id,
        handle: studentHandle.handle,
        emoji: studentHandle.emoji,
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

  let claim:
    | { teacher_id: number; teacher_handle: string; teacher_emoji: string; expires_at: string }
    | null = null;
  if (claimRow) {
    const { data: t } = await sb
      .from("users")
      .select("tg_user_id, display_handle, display_emoji")
      .eq("id", claimRow.teacher_id)
      .single();
    const h = resolveHandle(t);
    claim = {
      teacher_id: claimRow.teacher_id,
      teacher_handle: h.handle,
      teacher_emoji: h.emoji,
      expires_at: claimRow.expires_at,
    };
  }

  return Response.json({ messages, claim, student }, { headers: noStoreHeaders });
}
