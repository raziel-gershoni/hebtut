import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RawMessage {
  id: number;
  direction: "in" | "out";
  text_content: string;
  author_id: number | null;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me))
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const userId = Number(params.userId);
  if (!Number.isInteger(userId))
    return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const anonMode = await getDisplayAnonymousHandlesEnabled();
  const { data: targetUser, error: uErr } = await sb
    .from("users")
    .select(
      "id, name, display_handle, display_emoji, tg_username, tg_user_id, avatar_file_id",
    )
    .eq("id", userId)
    .single();
  if (uErr || !targetUser)
    return new Response("not found", { status: 404, headers: noStoreHeaders });

  const { data: rows, error } = await sb
    .from("feedback_messages")
    .select("id, direction, text_content, author_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Resolve author handles for outbound (admin) messages so the UI can show
  // multi-admin attribution.
  const authorIds = Array.from(
    new Set(
      ((rows ?? []) as RawMessage[])
        .filter((m) => m.direction === "out" && m.author_id != null)
        .map((m) => m.author_id as number),
    ),
  );
  const authorsById = new Map<number, { id: number; handle: string }>();
  if (authorIds.length > 0) {
    const { data: authors } = await sb
      .from("users")
      .select("id, name, preferred_name, display_handle, display_emoji, tg_user_id, avatar_file_id")
      .in("id", authorIds);
    for (const a of authors ?? []) {
      // Same resolver as /api/threads — respects the global names-vs-handles
      // toggle so an admin's bubble shows their real (or preferred) name in
      // names mode, not the animal handle.
      const d = resolveDisplay(a, anonMode);
      authorsById.set(a.id, { id: a.id, handle: d.handle });
    }
  }

  const messages = ((rows ?? []) as RawMessage[]).map((m) => ({
    id: m.id,
    direction: m.direction,
    text_content: m.text_content,
    created_at: m.created_at,
    author:
      m.direction === "out" && m.author_id != null
        ? authorsById.get(m.author_id) ?? null
        : null,
  }));

  // Active claim for this user, if any.
  const nowIso = new Date().toISOString();
  const { data: claimRow } = await sb
    .from("feedback_claims")
    .select("admin_id, expires_at")
    .eq("user_id", userId)
    .gt("expires_at", nowIso)
    .maybeSingle();
  let claim:
    | {
        admin_id: number;
        admin_handle: string;
        is_self: boolean;
        expires_at: string;
      }
    | null = null;
  if (claimRow) {
    const { data: holder } = await sb
      .from("users")
      .select("display_handle, tg_user_id")
      .eq("id", claimRow.admin_id)
      .single();
    claim = {
      admin_id: claimRow.admin_id,
      admin_handle:
        holder?.display_handle ?? userHandle(holder?.tg_user_id ?? 0).handle,
      is_self: claimRow.admin_id === me.id,
      expires_at: claimRow.expires_at,
    };
  }

  return Response.json(
    {
      user: {
        id: targetUser.id,
        name: targetUser.name,
        display_handle: targetUser.display_handle,
        display_emoji: targetUser.display_emoji,
        tg_username: targetUser.tg_username,
        tg_user_id: targetUser.tg_user_id,
        has_avatar: !!targetUser.avatar_file_id,
      },
      messages,
      claim,
    },
    { headers: noStoreHeaders },
  );
}
