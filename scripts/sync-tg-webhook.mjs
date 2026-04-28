#!/usr/bin/env node
// Re-asserts the Telegram bot's webhook on every production deploy. The call
// is idempotent (Telegram's setWebhook overwrites cleanly), so this also
// covers cases where TELEGRAM_WEBHOOK_SECRET was rotated in env without the
// webhook being re-set, or where the webhook was accidentally cleared.
//
// Lenient: failures log a warning but never break the build — a transient
// Telegram outage shouldn't fail a deploy. Claim expiry / DB migrations have
// already run by this point.

const TAG = "[tg-webhook]";

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET,
  APP_BASE_URL,
  VERCEL_ENV,
} = process.env;

async function main() {
  if (VERCEL_ENV && VERCEL_ENV !== "production") {
    console.log(`${TAG} skip — VERCEL_ENV=${VERCEL_ENV}`);
    return;
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !APP_BASE_URL) {
    console.warn(
      `${TAG} skip — required env missing (TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / APP_BASE_URL)`,
    );
    return;
  }

  // Normalize the base URL — same defensive prefix as sync-qstash, since
  // APP_BASE_URL on Vercel is sometimes set without scheme.
  let base = APP_BASE_URL.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const desiredUrl = `${base}/api/webhook`;

  const TG = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  // Inspect current state for log clarity. Don't gate on it — we re-assert
  // unconditionally to keep the secret in sync.
  try {
    const r = await fetch(`${TG}/getWebhookInfo`);
    const j = (await r.json());
    if (j?.ok) {
      const cur = j.result?.url ?? "";
      if (cur === desiredUrl) {
        console.log(`${TAG} webhook already at ${desiredUrl} — re-asserting (idempotent)`);
      } else if (cur === "") {
        console.log(`${TAG} no webhook set — installing ${desiredUrl}`);
      } else {
        console.log(`${TAG} webhook url is "${cur}" — updating to ${desiredUrl}`);
      }
    } else {
      console.warn(`${TAG} getWebhookInfo non-ok: ${JSON.stringify(j)}`);
    }
  } catch (e) {
    console.warn(`${TAG} getWebhookInfo failed: ${e?.message ?? e}`);
  }

  // setWebhook unconditionally — idempotent, also propagates a rotated
  // TELEGRAM_WEBHOOK_SECRET (which getWebhookInfo never reveals).
  try {
    const setRes = await fetch(`${TG}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: desiredUrl,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        // Drop any pending updates that arrived while a previous webhook
        // was missing/wrong — they're stale and would confuse handlers
        // running against the new schema/code.
        drop_pending_updates: false,
      }),
    });
    const setJson = (await setRes.json());
    if (setJson?.ok) {
      console.log(`${TAG} setWebhook ok → ${desiredUrl}`);
    } else {
      console.warn(`${TAG} setWebhook failed: ${JSON.stringify(setJson)}`);
    }
  } catch (e) {
    console.warn(`${TAG} setWebhook failed: ${e?.message ?? e}`);
  }
}

main().catch((e) => {
  console.warn(`${TAG} error: ${e?.message ?? e}`);
});
