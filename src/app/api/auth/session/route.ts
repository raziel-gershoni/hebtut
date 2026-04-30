import { NextRequest } from "next/server";
import { verifyInitData, parseInitData, mintSupabaseJwt } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ensureBootstrapAdmin } from "@/server/bootstrap";
import { refreshUserAvatar } from "@/server/avatars";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const body = await readJsonBody<{ initData?: string }>(req);
  const initData = body.initData ?? "";
  const v = verifyInitData(initData, serverEnv.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return Response.json({ error: v.reason }, { status: 401 });

  const parsed = parseInitData(v.data);
  await ensureBootstrapAdmin();
  const sb = getServiceRoleClient();

  // Display name derived from validated initData. Used both for INSERT on first
  // sight and to refresh the row if the stored name has drifted (incl. clearing
  // the bootstrap.ts placeholder of NULL on first Mini App load by an admin).
  const display =
    [parsed.user.first_name, parsed.user.last_name].filter(Boolean).join(" ").trim() ||
    parsed.user.username ||
    `user ${parsed.user.id}`;
  const tgUsername = parsed.user.username ?? null;

  const { data: existing } = await sb
    .from("users")
    .select("id, role, is_admin, name, tg_username, avatar_file_id, avatar_fetched_at")
    .eq("tg_user_id", parsed.user.id)
    .maybeSingle();

  let userRow: {
    id: number;
    role: string;
    is_admin: boolean;
    name: string | null;
    avatar_file_id: string | null;
  };
  if (!existing) {
    const h = userHandle(parsed.user.id);
    const { data, error } = await sb
      .from("users")
      .insert({
        tg_user_id: parsed.user.id,
        tg_chat_id: parsed.user.id, // best-effort; real chat_id arrives via the bot webhook
        name: display,
        tg_username: tgUsername,
        display_handle: h.handle,
        display_emoji: h.emoji,
        role: "student",
      })
      .select("id, role, is_admin, name, avatar_file_id")
      .single();
    if (error || !data) return Response.json({ error: error?.message ?? "insert failed" }, { status: 500 });
    userRow = data;
  } else if (existing.name !== display || existing.tg_username !== tgUsername) {
    const { data, error } = await sb
      .from("users")
      .update({ name: display, tg_username: tgUsername })
      .eq("id", existing.id)
      .select("id, role, is_admin, name, avatar_file_id")
      .single();
    if (error || !data) {
      console.warn("name refresh failed", { reason: error?.message });
      userRow = existing;
    } else {
      userRow = data;
    }
  } else {
    userRow = existing;
  }

  // First-ever Mini App open for someone who never `/start`'d (e.g. a fresh
  // bootstrap admin) — fetch their TG avatar so the chat list has it.
  if (existing && existing.avatar_fetched_at == null) {
    await refreshUserAvatar(existing.id, parsed.user.id);
  }

  const jwt = await mintSupabaseJwt(parsed.user.id, userRow.role);
  return Response.json(
    {
      jwt,
      user: {
        id: userRow.id,
        role: userRow.role,
        is_admin: userRow.is_admin,
        name: userRow.name,
        has_avatar: !!userRow.avatar_file_id,
      },
    },
    { headers: noStoreHeaders },
  );
}
