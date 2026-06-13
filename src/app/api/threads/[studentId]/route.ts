import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";
import { getSignedRemainingForManyToday } from "@/server/quota";
import { signedStudentMediaUrl } from "@/server/media-storage";

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

  // Mode picks names-vs-handles for every display field below.
  const anonMode = await getDisplayAnonymousHandlesEnabled();

  const { data: rawMessages, error } = await sb
    .from("messages")
    .select(
      "id, direction, kind, duration, status, reply_to_id, created_at, teacher_id, text_content, media_library_id, transcript_text, transcript_tg_message_id, translation_text, translation_tg_message_id, storage_path, storage_caf_path",
    )
    .eq("student_id", studentId)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Pull library metadata for any outbound media bubbles in one round-trip,
  // keyed back to the message by media_library_id. Done as a separate query
  // rather than a foreign-table embed because Supabase's TS client cannot
  // infer that relationship without generated types.
  const mediaLibIds = Array.from(
    new Set(
      (rawMessages ?? [])
        .map((m) => m.media_library_id)
        .filter((v): v is number => v != null),
    ),
  );
  const { data: libRows } = mediaLibIds.length
    ? await sb
        .from("media_library")
        .select("id, title, description, original_filename, bytes, kind, storage_path")
        .in("id", mediaLibIds)
    : { data: [] as {
        id: number;
        title: string | null;
        description: string | null;
        original_filename: string;
        bytes: number;
        kind: "photo" | "video" | "audio";
        storage_path: string;
      }[] };
  const libById = new Map<
    number,
    {
      title: string | null;
      description: string | null;
      original_filename: string;
      bytes: number;
      kind: "photo" | "video" | "audio";
      storage_path: string;
    }
  >();
  for (const l of libRows ?? []) {
    libById.set(l.id, {
      title: l.title,
      description: l.description,
      original_filename: l.original_filename,
      bytes: l.bytes,
      kind: l.kind as "photo" | "video" | "audio",
      storage_path: l.storage_path,
    });
  }

  // Resolve every distinct teacher referenced by an outbound row in one shot,
  // so the client can render per-bubble avatars/handles without N round-trips.
  const teacherIds = Array.from(
    new Set(
      (rawMessages ?? [])
        .map((m) => m.teacher_id)
        .filter((id): id is number => id != null),
    ),
  );
  const teachersById = new Map<
    number,
    { id: number; handle: string; emoji: string | null; has_avatar: boolean }
  >();
  if (teacherIds.length > 0) {
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, tg_user_id, display_handle, display_emoji, name, preferred_name, avatar_file_id")
      .in("id", teacherIds);
    for (const t of teacherRows ?? []) {
      const d = resolveDisplay(t, anonMode);
      teachersById.set(t.id, {
        id: t.id,
        handle: d.handle,
        emoji: d.emoji,
        has_avatar: d.has_avatar,
      });
    }
  }
  // Mint short-lived presigned R2 URLs for stored media so the client plays
  // straight from R2 (zero Vercel egress). Signing is local crypto (no network),
  // so doing it per-row is cheap. If R2 is unconfigured / signing throws, leave
  // the URLs null and the bubble falls back to the /api/media proxy.
  const messages = await Promise.all(
    (rawMessages ?? []).map(async (m) => {
      let storage_url: string | null = null;
      let storage_caf_url: string | null = null;
      if (m.storage_path) {
        try {
          storage_url = await signedStudentMediaUrl(m.storage_path);
          // Sign the CAF in its own try so a caf-only failure doesn't also drop
          // the (working) ogg URL — old WebKit keeps a playable ogg.
          if (m.storage_caf_path) {
            try {
              storage_caf_url = await signedStudentMediaUrl(m.storage_caf_path);
            } catch {
              storage_caf_url = null;
            }
          }
        } catch {
          storage_url = null;
          storage_caf_url = null;
        }
      }
      return {
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
        media_library_id: m.media_library_id ?? null,
        media_library: m.media_library_id != null ? libById.get(m.media_library_id) ?? null : null,
        storage_url,
        storage_caf_url,
        transcript_text: m.transcript_text ?? null,
        transcript_tg_message_id: m.transcript_tg_message_id ?? null,
        translation_text: m.translation_text ?? null,
        translation_tg_message_id: m.translation_tg_message_id ?? null,
      };
    }),
  );

  const { data: studentRow } = await sb
    .from("users")
    .select("id, tg_user_id, display_handle, display_emoji, name, preferred_name, avatar_file_id")
    .eq("id", studentId)
    .single();
  const studentDisplay = resolveDisplay(studentRow, anonMode);
  const student = studentRow
    ? {
        id: studentRow.id,
        handle: studentDisplay.handle,
        emoji: studentDisplay.emoji,
        has_avatar: studentDisplay.has_avatar,
      }
    : null;

  // Active-claim surface so the thread UI can show "X handling".
  const nowIso = new Date().toISOString();
  const { data: claimRow } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", studentId)
    .gt("expires_at", nowIso)
    .maybeSingle();

  let claim:
    | {
        teacher_id: number;
        teacher_handle: string;
        teacher_emoji: string | null;
        teacher_has_avatar: boolean;
        expires_at: string;
      }
    | null = null;
  if (claimRow) {
    const { data: t } = await sb
      .from("users")
      .select("tg_user_id, display_handle, display_emoji, name, preferred_name, avatar_file_id")
      .eq("id", claimRow.teacher_id)
      .single();
    const d = resolveDisplay(t, anonMode);
    claim = {
      teacher_id: claimRow.teacher_id,
      teacher_handle: d.handle,
      teacher_emoji: d.emoji,
      teacher_has_avatar: d.has_avatar,
      expires_at: claimRow.expires_at,
    };
  }

  const quotaMap = await getSignedRemainingForManyToday([studentId]);
  const quota_remaining_seconds = quotaMap.get(studentId) ?? 0;

  return Response.json(
    { messages, claim, student, quota_remaining_seconds },
    { headers: noStoreHeaders },
  );
}
