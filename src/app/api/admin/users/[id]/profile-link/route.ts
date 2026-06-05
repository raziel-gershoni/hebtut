import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { getBot } from "@/lib/tg";
import { recordAudit } from "@/server/audit";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Sends the admin a DM containing a Telegram text-mention pointing at
 * the target user. Tapping the mention in the bot chat opens that
 * user's profile — the only working route to a no-username user from
 * outside a bot-message context (Telegram's docs explicitly call
 * `tg://user?id=…` "Bot API only", so it can't be navigated to via
 * openTelegramLink/window.open from a Mini App).
 *
 * Auth: admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const [adminRes, targetRes] = await Promise.all([
    sb.from("users").select("tg_chat_id").eq("id", me.id).maybeSingle(),
    sb
      .from("users")
      .select(
        "tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id",
      )
      .eq("id", targetId)
      .maybeSingle(),
  ]);
  if (!adminRes.data?.tg_chat_id) {
    return new Response("admin chat not found", { status: 500, headers: noStoreHeaders });
  }
  if (!targetRes.data) {
    return new Response("user not found", { status: 404, headers: noStoreHeaders });
  }

  const anonMode = await getDisplayAnonymousHandlesEnabled();
  const label = resolveDisplay(targetRes.data, anonMode).handle;
  const text = `👤 ${escapeHtml(label)}`;

  try {
    // Inline-keyboard URL button with tg://user?id=… is the Bot-API-blessed
    // way to spawn a "open user profile" button. Same mechanism as
    // inputKeyboardButtonUserProfile — bigger tap target than an inline
    // text-mention, and the affordance reads as a real action.
    await getBot().api.sendMessage(adminRes.data.tg_chat_id, text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "👤 Открыть профиль",
              url: `tg://user?id=${targetRes.data.tg_user_id}`,
            },
          ],
        ],
      },
    });
  } catch (e) {
    console.warn("profile-link DM failed", {
      admin_chat_id: adminRes.data.tg_chat_id,
      target_id: targetId,
      reason: (e as Error).message,
    });
    return new Response("tg send failed", { status: 502, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "admin.user_profile_link",
    actorId: me.id,
    subjectType: "user",
    subjectId: targetId,
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}

// Minimal HTML escape for the bot's parse_mode=HTML — covers the four
// reserved characters per the Telegram Bot API docs.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
