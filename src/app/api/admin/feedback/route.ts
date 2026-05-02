import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RawMessage {
  id: number;
  user_id: number;
  direction: "in" | "out";
  text_content: string;
  status: "sent" | "read";
  created_at: string;
}

interface RawUser {
  id: number;
  name: string | null;
  display_handle: string | null;
  display_emoji: string | null;
  tg_username: string | null;
  tg_user_id: number;
  avatar_file_id: string | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user))
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  // Pull the recent slice — for the PoC we don't paginate.
  const { data: rawMsgs, error } = await sb
    .from("feedback_messages")
    .select("id, user_id, direction, text_content, status, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });
  const msgs = (rawMsgs ?? []) as RawMessage[];

  // Reduce per user_id.
  const lastByUser = new Map<number, RawMessage>();
  const unreadByUser = new Map<number, number>();
  for (const m of msgs) {
    if (!lastByUser.has(m.user_id)) lastByUser.set(m.user_id, m);
    if (m.direction === "in" && m.status === "sent") {
      unreadByUser.set(m.user_id, (unreadByUser.get(m.user_id) ?? 0) + 1);
    }
  }

  const userIds = Array.from(lastByUser.keys());
  const usersById = new Map<number, RawUser>();
  if (userIds.length > 0) {
    const { data: rows } = await sb
      .from("users")
      .select(
        "id, name, display_handle, display_emoji, tg_username, tg_user_id, avatar_file_id",
      )
      .in("id", userIds);
    for (const r of (rows ?? []) as RawUser[]) usersById.set(r.id, r);
  }

  // Active feedback_claims for these users so the list can show "Берёт X".
  const nowIso = new Date().toISOString();
  const claimByUser = new Map<
    number,
    { admin_id: number; admin_handle: string; is_self: boolean }
  >();
  if (userIds.length > 0) {
    const { data: claimRows } = await sb
      .from("feedback_claims")
      .select("user_id, admin_id")
      .in("user_id", userIds)
      .gt("expires_at", nowIso);
    if (claimRows && claimRows.length > 0) {
      const adminIds = Array.from(new Set(claimRows.map((c) => c.admin_id)));
      const { data: adminRows } = await sb
        .from("users")
        .select("id, display_handle, tg_user_id")
        .in("id", adminIds);
      const adminHandle = new Map<number, string>();
      for (const a of adminRows ?? []) {
        adminHandle.set(a.id, a.display_handle ?? userHandle(a.tg_user_id).handle);
      }
      for (const c of claimRows) {
        claimByUser.set(c.user_id, {
          admin_id: c.admin_id,
          admin_handle: adminHandle.get(c.admin_id) ?? "Админ",
          is_self: c.admin_id === user.id,
        });
      }
    }
  }

  const chats = userIds
    .map((uid) => {
      const u = usersById.get(uid);
      const last = lastByUser.get(uid)!;
      return {
        user: u
          ? {
              id: u.id,
              name: u.name,
              display_handle: u.display_handle,
              display_emoji: u.display_emoji,
              tg_username: u.tg_username,
              tg_user_id: u.tg_user_id,
              has_avatar: !!u.avatar_file_id,
            }
          : null,
        last_message: {
          direction: last.direction,
          text_content: last.text_content,
          created_at: last.created_at,
        },
        unread_count: unreadByUser.get(uid) ?? 0,
        claim: claimByUser.get(uid) ?? null,
      };
    })
    .filter((c) => c.user !== null)
    .sort((a, b) =>
      b.last_message.created_at.localeCompare(a.last_message.created_at),
    );

  return Response.json({ chats }, { headers: noStoreHeaders });
}
