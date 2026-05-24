#!/usr/bin/env node
// DMs each admin in BOOTSTRAP_ADMIN_TG_USER_IDS when a production deploy
// finishes its build phase. Runs as the last step of `vercel-build` so it
// only fires when `next build` succeeded — failed builds never trigger.
//
// Lenient like sync-tg-webhook.mjs / sync-qstash.mjs: missing env or a
// Telegram outage logs a warning and exits 0. The notification is a nicety;
// it must not block a deploy.

const TAG = "[deploy-notify]";

const {
  TELEGRAM_BOT_TOKEN,
  BOOTSTRAP_ADMIN_TG_USER_IDS,
  VERCEL_ENV,
  VERCEL_GIT_COMMIT_SHA,
  VERCEL_GIT_COMMIT_REF,
  VERCEL_GIT_COMMIT_MESSAGE,
  VERCEL_GIT_REPO_OWNER,
  VERCEL_GIT_REPO_SLUG,
} = process.env;

async function main() {
  if (VERCEL_ENV && VERCEL_ENV !== "production") {
    console.log(`${TAG} skip — VERCEL_ENV=${VERCEL_ENV}`);
    return;
  }
  if (!TELEGRAM_BOT_TOKEN || !BOOTSTRAP_ADMIN_TG_USER_IDS) {
    console.warn(
      `${TAG} skip — required env missing (TELEGRAM_BOT_TOKEN / BOOTSTRAP_ADMIN_TG_USER_IDS)`,
    );
    return;
  }

  // Mirrors the parser at src/lib/env.ts:4-19 — split on commas, trim, drop
  // empties, parse as positive int. Replicated here because this script
  // runs outside the Next.js bundle and can't import from src/.
  const adminIds = BOOTSTRAP_ADMIN_TG_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (adminIds.length === 0) {
    console.warn(`${TAG} skip — no valid admin TG IDs after parsing`);
    return;
  }

  const text = buildMessage();
  const TG = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  // Per-recipient try/catch so one bad chat_id doesn't sink the rest.
  for (const chatId of adminIds) {
    try {
      const r = await fetch(TG, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          // The GitHub commit link would otherwise produce a preview card
          // on every deploy — noisy. Suppress it.
          disable_web_page_preview: true,
        }),
      });
      if (r.ok) {
        console.log(`${TAG} sent to ${chatId}`);
      } else {
        const body = await r.text().catch(() => "");
        console.warn(`${TAG} send to ${chatId} failed: ${r.status} ${body}`);
      }
    } catch (e) {
      console.warn(`${TAG} send to ${chatId} threw: ${(e && e.message) || e}`);
    }
  }
}

function buildMessage() {
  const lines = ["🚀 Deploy live"];
  const sha = VERCEL_GIT_COMMIT_SHA ? VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null;
  const ref = VERCEL_GIT_COMMIT_REF || null;
  if (sha || ref) {
    lines.push([sha, ref].filter(Boolean).join(" · "));
  }
  if (VERCEL_GIT_COMMIT_MESSAGE) {
    const subject = VERCEL_GIT_COMMIT_MESSAGE.split("\n")[0].trim();
    if (subject) lines.push(subject);
  }
  if (VERCEL_GIT_COMMIT_SHA && VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG) {
    lines.push(
      `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}/commit/${VERCEL_GIT_COMMIT_SHA}`,
    );
  }
  return lines.join("\n");
}

main().catch((e) => {
  // Belt-and-suspenders. main() already catches per-recipient errors; this
  // catches anything outside the loop. Still don't fail the deploy.
  console.warn(`${TAG} unexpected error (ignored): ${(e && e.message) || e}`);
});
