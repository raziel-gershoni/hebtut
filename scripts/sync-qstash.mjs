#!/usr/bin/env node
// Create the QStash schedule for /api/cron/expire-claims on first production
// deploy. Idempotent: if a schedule with the same destination already exists,
// we leave it alone (so any manually-created schedule survives untouched).
// Failures never block the build — claim expiry degrades gracefully without
// the cron, see INFRA.md §5.

const TAG = "[qstash-sync]";

const {
  QSTASH_TOKEN,
  QSTASH_URL,
  APP_BASE_URL,
  CRON_SECRET,
  VERCEL_ENV,
} = process.env;

const ENDPOINT_PATH = "/api/cron/expire-claims";
const CRON = "*/5 * * * *";
// Default to the global endpoint; users on a regional account
// (e.g. https://qstash-us-east-1.upstash.io) override via QSTASH_URL.
const QSTASH = `${(QSTASH_URL ?? "https://qstash.upstash.io").replace(/\/$/, "")}/v2/schedules`;

async function main() {
  // Only sync on production deploys. Previews / local builds are no-ops.
  if (VERCEL_ENV && VERCEL_ENV !== "production") {
    console.log(`${TAG} skip — VERCEL_ENV=${VERCEL_ENV}`);
    return;
  }
  if (!QSTASH_TOKEN) {
    console.log(`${TAG} skip — QSTASH_TOKEN not set`);
    return;
  }
  if (!APP_BASE_URL || !CRON_SECRET) {
    console.warn(`${TAG} skip — APP_BASE_URL or CRON_SECRET missing`);
    return;
  }

  // Normalize: if APP_BASE_URL is set to a bare hostname (no scheme), prepend
  // https:// so QStash accepts the destination. Vercel sometimes provides
  // hostnames without scheme via VERCEL_URL — same pitfall.
  let base = APP_BASE_URL.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const destination = `${base}${ENDPOINT_PATH}`;
  const auth = { Authorization: `Bearer ${QSTASH_TOKEN}` };

  // 1) List schedules and check whether ours already exists.
  const listRes = await fetch(QSTASH, { headers: auth });
  if (!listRes.ok) {
    console.warn(`${TAG} list failed (${listRes.status}): ${await listRes.text()}`);
    return;
  }
  const schedules = await listRes.json();
  if (!Array.isArray(schedules)) {
    console.warn(`${TAG} unexpected list payload: ${JSON.stringify(schedules)}`);
    return;
  }
  const existing = schedules.find((s) => s?.destination === destination);
  if (existing) {
    console.log(
      `${TAG} schedule already present (id=${existing.scheduleId}, cron=${existing.cron}) — not modifying`,
    );
    return;
  }

  // 2) Create the schedule. The destination URL goes directly into the
  // path — NOT URL-encoded. QStash's router treats the path opaquely, so
  // percent-encoded `https%3A%2F%2F…` is rejected as having no scheme.
  const createRes = await fetch(`${QSTASH}/${destination}`, {
    method: "POST",
    headers: {
      ...auth,
      "Upstash-Cron": CRON,
      "Upstash-Method": "POST",
      // Upstash-Forward-* headers have the prefix stripped and forwarded to
      // the destination. The bare `Authorization` header would be intercepted
      // by QStash for its own signature, hence the prefix.
      "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`,
    },
  });
  if (!createRes.ok) {
    console.warn(`${TAG} create failed (${createRes.status}): ${await createRes.text()}`);
    return;
  }
  const body = await createRes.json().catch(() => ({}));
  console.log(`${TAG} created schedule (id=${body?.scheduleId ?? "?"}) → ${destination}`);
}

main().catch((e) => {
  console.warn(`${TAG} error: ${e?.message ?? e}`);
});
