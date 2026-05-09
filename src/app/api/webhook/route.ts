import type { NextRequest } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { ensureBootstrapAdmin } from "@/server/bootstrap";
import { handleStart } from "@/server/handlers/start";
import { handleStudentMedia } from "@/server/handlers/student-message";
import { handleTeacherReply } from "@/server/handlers/teacher-reply";
import { handleUnknown } from "@/server/handlers/unknown";
import { handlePreCheckoutQuery, handleSuccessfulPayment } from "@/server/handlers/billing-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let installed = false;
function installHandlers(): void {
  if (installed) return;
  const bot = getBot();
  bot.command("start", handleStart);
  // Billing events come BEFORE the generic message handler so successful_payment
  // service messages don't fall through to handleUnknown.
  bot.on("pre_checkout_query", handlePreCheckoutQuery);
  bot.on("message:successful_payment", handleSuccessfulPayment);
  bot.on(["message:voice", "message:video_note"], async (ctx) => {
    // Prefer the teacher-reply route (reply_to_message present + sender is teacher).
    const handledAsTeacher = await handleTeacherReply(ctx);
    if (handledAsTeacher) return;
    // Otherwise route as inbound student media.
    await handleStudentMedia(ctx);
  });
  bot.on("message", handleUnknown);
  installed = true;
}

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;
  installHandlers();
  cachedHandler = webhookCallback(getBot(), "std/http") as unknown as (
    req: Request,
  ) => Promise<Response>;
  return cachedHandler;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== serverEnv.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  await ensureBootstrapAdmin();
  return getHandler()(req);
}
