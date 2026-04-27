import { Bot } from "grammy";
import { serverEnv } from "./env";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (bot) return bot;
  bot = new Bot(serverEnv.TELEGRAM_BOT_TOKEN);
  return bot;
}
