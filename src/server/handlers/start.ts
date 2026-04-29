import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday } from "@/server/quota";
import { refreshUserAvatar } from "@/server/avatars";

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
    .select("id, role, is_admin, tz")
    .eq("tg_user_id", from.id)
    .maybeSingle();

  if (!existing) {
    const { data: inserted } = await sb
      .from("users")
      .insert({
        tg_user_id: from.id,
        tg_chat_id: chat.id,
        name: display,
        role: "pending",
      })
      .select("id")
      .single();
    if (inserted) await refreshUserAvatar(inserted.id, from.id);
    await ctx.reply(ru.greetingRegistered);
    return;
  }

  // Refresh chat_id and name (the user may have re-/started or changed display name).
  await sb.from("users").update({ tg_chat_id: chat.id, name: display }).eq("id", existing.id);
  // Opportunistic avatar refresh on every /start.
  await refreshUserAvatar(existing.id, from.id);

  // Greeting precedence:
  //   admin (with or without a working role) → teacher/admin greeting
  //   role=teacher → teacher/admin greeting
  //   role=student → student greeting with quota
  //   role=pending && !is_admin → wait-for-admin greeting
  if (existing.is_admin || existing.role === "teacher") {
    await ctx.reply(ru.greetingTeacher);
    return;
  }
  if (existing.role === "student") {
    const remaining = await getRemainingForToday(existing.id, existing.tz);
    await ctx.reply(ru.greetingStudent(formatDuration(remaining)));
    return;
  }
  await ctx.reply(ru.greetingRegistered);
}
