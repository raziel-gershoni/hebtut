// PoC-SHORTCUT: This endpoint 302s to Telegram's CDN, and the redirect URL contains the bot token.
// Acceptable for trusted teachers + easy token rotation in BotFather. Replace before public release.

import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403 });
  }
  const messageId = Number(params.messageId);
  if (!Number.isInteger(messageId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, student_id, kind, file_id")
    .eq("id", messageId)
    .single();
  if (!msg) return new Response("not found", { status: 404 });

  // Text messages have no media to redirect to.
  if (msg.kind === "text" || !msg.file_id) {
    return new Response("not media", { status: 400 });
  }

  if (!user.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", msg.student_id)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403 });
  }

  const file = await getBot().api.getFile(msg.file_id);
  if (!file.file_path) return new Response("no path", { status: 502 });

  const url = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  return Response.redirect(url, 302);
}
