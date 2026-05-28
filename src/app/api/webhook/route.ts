import type { NextRequest } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { ensureBootstrapAdmin } from "@/server/bootstrap";
import { handleStart } from "@/server/handlers/start";
import { handleStudentMedia } from "@/server/handlers/student-message";
import { handleTeacherReply, handleTeacherReplyText } from "@/server/handlers/teacher-reply";
import { handleUnknown } from "@/server/handlers/unknown";
import { handlePreCheckoutQuery, handleSuccessfulPayment } from "@/server/handlers/billing-events";
import { handleOnboardingCallback, handleOnboardingNameInput } from "@/server/handlers/onboarding-callbacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bump per-function timeout. The fresh-send path for an onboarding
// video_note has to fetch the file from Supabase and forward it to TG
// via multipart inside this single function invocation — Vercel's
// default 10 s cap (Hobby plan limit) can be tight. 60 s is the Pro
// ceiling; the directive is a no-op if the project's on Hobby.
export const maxDuration = 60;

let installed = false;
function installHandlers(): void {
  if (installed) return;
  const bot = getBot();
  bot.command("start", handleStart);
  // Onboarding inline-keyboard buttons. callbackQuery filter scopes to
  // `data` matches; the handler stale-checks state itself.
  bot.callbackQuery(/^onb:/, handleOnboardingCallback);
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
  // Text from a student in onboarding state 'awaiting_name' is their reply
  // to "Как тебя зовут?" — captured into users.name, then onboarding advances
  // to cta_record. Returns true when consumed; otherwise falls through.
  // Must come BEFORE the teacher-reply text handler so a student's name
  // input never gets mis-routed.
  bot.on("message:text", async (ctx, next) => {
    const handled = await handleOnboardingNameInput(ctx);
    if (!handled) await next();
  });
  // Teacher swipe-reply with TEXT instead of voice. Strictly gated: handler
  // returns false unless sender is a teacher AND replied to a known prompt
  // AND it isn't a slash command. Anything that doesn't match falls through
  // to handleUnknown via next() — student typing in chat still gets the
  // generic 'I only understand voice' fallback. No kind='text' row is ever
  // created with direction='in'; the messages_text_only_outbound CHECK
  // constraint is the second line of defence.
  bot.on("message:text", async (ctx, next) => {
    const handled = await handleTeacherReplyText(ctx);
    if (!handled) await next();
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

  // Consume the body once. We need it for (a) update_id dedup and (b)
  // re-pass to grammY's webhookCallback. NextRequest's body is a
  // single-use ReadableStream so we save the string here.
  const body = await req.text();
  let updateId: number | null = null;
  try {
    const parsed = JSON.parse(body) as { update_id?: unknown };
    if (typeof parsed.update_id === "number" && Number.isInteger(parsed.update_id)) {
      updateId = parsed.update_id;
    }
  } catch {
    // Malformed body — let grammY produce its own 400. No dedup.
  }

  // Atomic SETNX with 24 h TTL. TG retries unacked updates with the
  // same update_id for up to ~24 h with backoff; after that no chance
  // of recurrence. A `null` return means the key already existed → TG
  // retry → ack 200 and skip the handler. The previous behaviour (no
  // dedup) let slow handlers (transcribe + translate inline run 30-50s,
  // past TG's ~30s retry window) re-fire `bot.api.sendVoice` on every
  // retry, giving the student 2-3 copies of the relayed audio.
  if (updateId != null) {
    try {
      const result = await getRedis().set(`webhook:${updateId}`, "1", {
        nx: true,
        ex: 86400,
      });
      if (result === null) {
        return new Response("ok (dup)", { status: 200 });
      }
    } catch (e) {
      // Fail-soft: log + proceed. Dropping a legitimate update to
      // enforce dedup is worse than the occasional duplicate.
      console.warn("[webhook] dedup SETNX failed; proceeding", {
        update_id: updateId,
        err: (e as Error).message,
      });
    }
  }

  await ensureBootstrapAdmin();
  // Reconstruct the Request — grammY's webhookCallback reads the body
  // itself. Preserve method + headers + body verbatim.
  const reqForHandler = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
  return getHandler()(reqForHandler);
}
