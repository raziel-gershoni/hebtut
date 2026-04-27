import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday } from "@/server/quota";

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) return;

  const sb = getServiceRoleClient();
  const display =
    [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
    from.username ||
    `user ${from.id}`;

  const { data: existing } = await sb
    .from("users")
    .select("id, role, tz")
    .eq("tg_user_id", from.id)
    .maybeSingle();

  if (!existing) {
    await sb.from("users").insert({
      tg_user_id: from.id,
      tg_chat_id: chat.id,
      name: display,
      role: "pending",
    });
    await ctx.reply(ru.greetingRegistered);
    return;
  }

  // Refresh chat_id and name (the user may have re-/started or changed display name).
  await sb.from("users").update({ tg_chat_id: chat.id, name: display }).eq("id", existing.id);

  switch (existing.role) {
    case "pending":
      await ctx.reply(ru.greetingRegistered);
      return;
    case "teacher":
    case "admin":
      await ctx.reply(ru.greetingTeacher);
      return;
    case "student": {
      const remaining = await getRemainingForToday(existing.id, existing.tz);
      await ctx.reply(ru.greetingStudent(formatDuration(remaining)));
      return;
    }
  }
}
