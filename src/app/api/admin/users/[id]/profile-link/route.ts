import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { getBot } from "@/lib/tg";
import { isButtonPrivacyError } from "@/lib/tg-errors";
import { ru } from "@/lib/i18n";
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
  const safeLabel = escapeHtml(label);
  const tgUserId = targetRes.data.tg_user_id;
  const adminChatId = adminRes.data.tg_chat_id;

  try {
    // Inline-keyboard URL button with tg://user?id=… is the Bot-API-blessed
    // way to spawn a "open user profile" button. Same mechanism as
    // inputKeyboardButtonUserProfile — bigger tap target than an inline
    // text-mention, and the affordance reads as a real action.
    await getBot().api.sendMessage(adminChatId, ru.bot.profileLink.message(safeLabel), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: ru.bot.profileLink.button, url: `tg://user?id=${tgUserId}` }],
        ],
      },
    });
  } catch (e) {
    const reason = (e as Error).message;
    // The target locked profile-linking in their privacy settings, so
    // Telegram refuses the button (BUTTON_USER_PRIVACY_RESTRICTED). No
    // tappable link is possible for them — fall back to a plain DM carrying
    // the numeric id so the admin can still find the user via search. Seeing
    // this error also confirms the id we sent was a valid TG id, not the
    // internal users.id.
    if (isButtonPrivacyError(reason)) {
      try {
        await getBot().api.sendMessage(
          adminChatId,
          ru.bot.profileLink.privacyFallback(safeLabel, tgUserId),
          { parse_mode: "HTML" },
        );
      } catch (e2) {
        console.warn("profile-link privacy-fallback DM failed", {
          admin_chat_id: adminChatId,
          target_id: targetId,
          target_tg_user_id: tgUserId,
          reason: (e2 as Error).message,
        });
        return new Response("tg send failed", { status: 502, headers: noStoreHeaders });
      }
      await recordAudit({
        action: "admin.user_profile_link",
        actorId: me.id,
        subjectType: "user",
        subjectId: targetId,
        meta: { fallback: "privacy" },
      });
      return Response.json({ ok: true, fallback: "privacy" }, { headers: noStoreHeaders });
    }
    console.warn("profile-link DM failed", {
      admin_chat_id: adminChatId,
      target_id: targetId,
      target_tg_user_id: tgUserId,
      reason,
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
