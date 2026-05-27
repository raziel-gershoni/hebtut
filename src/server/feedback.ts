import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";
import { ru } from "@/lib/i18n";

const SNIPPET_MAX = 200;

/**
 * When a user writes a feedback message, DM every admin with a snippet so
 * they see the ping even if they don't have the Mini App open. The DM
 * includes a `web_app` inline button that launches the Mini App straight
 * into the per-user thread.
 *
 * Fail-soft per admin — if one chat_id is bad, the others still go.
 */
export async function fanOutFeedbackToAdmins(args: {
  userId: number;
  text: string;
}): Promise<void> {
  const sb = getServiceRoleClient();

  // Display the user with full real-name + handle context — admins are the
  // only audience here, and they need the real identity to triage.
  const { data: user } = await sb
    .from("users")
    .select("name, preferred_name, tg_username, display_handle")
    .eq("id", args.userId)
    .single();
  const userLabel = (() => {
    const parts: string[] = [];
    const realName = user?.preferred_name?.trim() || user?.name?.trim();
    if (realName) parts.push(realName);
    if (user?.tg_username) parts.push(`@${user.tg_username}`);
    if (user?.display_handle && parts.length === 0) parts.push(user.display_handle);
    return parts.length > 0 ? parts.join(" ") : `user ${args.userId}`;
  })();

  const { data: admins } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("is_admin", true);
  if (!admins?.length) return;

  const bot = getBot();
  const snippet = args.text.slice(0, SNIPPET_MAX);
  const text = ru.bot.notifications.adminFeedbackPing(userLabel, snippet);
  const url = `${serverEnv.APP_BASE_URL.replace(/\/$/, "")}/admin/feedback/${args.userId}`;

  for (const admin of admins) {
    try {
      await bot.api.sendMessage(admin.tg_chat_id, text, {
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть", web_app: { url } }]],
        },
      });
    } catch (e) {
      console.warn("feedback admin DM failed", {
        chat_id: admin.tg_chat_id,
        reason: (e as Error).message,
      });
    }
  }
}
