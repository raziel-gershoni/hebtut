import type { Context } from "grammy";
import { ru } from "@/lib/i18n";

export async function handleUnknown(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  await ctx.reply(ru.unknownInput);
}
