// PoC-SHORTCUT: 302 redirect to Telegram's CDN exposes the bot token in the
// resulting URL. Same trade-off as /api/media/[messageId]. Replace with a
// token-proxying server-side fetch before going public.

import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) return new Response("forbidden", { status: 403 });

  const userId = Number(params.userId);
  if (!Number.isInteger(userId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: target } = await sb
    .from("users")
    .select("id, role, avatar_file_id")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return new Response("not found", { status: 404 });
  if (!target.avatar_file_id) return new Response("no avatar", { status: 404 });

  // Authz: real avatars are admin-only or self. Peer-facing chat surfaces use
  // the generated emoji avatar instead — see `Avatar` + `userHandle`.
  if (!me.isAdmin && target.id !== me.id) {
    return new Response("forbidden", { status: 403 });
  }

  let file;
  try {
    file = await getBot().api.getFile(target.avatar_file_id);
  } catch {
    return new Response("file not found", { status: 404 });
  }
  if (!file.file_path) return new Response("no path", { status: 502 });

  const url = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // Avatars don't change often; cache redirect for 15 min in the browser.
      // Within that window the redirect target's underlying TG file_path is
      // valid (~1h), so a re-issued redirect would still work.
      "Cache-Control": "public, max-age=900",
    },
  });
}
