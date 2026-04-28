#!/usr/bin/env node
// Create the QStash schedule for /api/cron/expire-claims on first production
// deploy. Idempotent: if a schedule with the same destination already exists,
// we leave it alone (so any manually-created schedule survives untouched).
// Failures never block the build — claim expiry degrades gracefully without
// the cron, see INFRA.md §5.

const TAG = "[qstash-sync]";

const {
  QSTASH_TOKEN,
  APP_BASE_URL,
  CRON_SECRET,
  VERCEL_ENV,
} = process.env;

const ENDPOINT_PATH = "/api/cron/expire-claims";
const CRON = "*/5 * * * *";
const QSTASH = "https://qstash.upstash.io/v2/schedules";

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

  const destination = `${APP_BASE_URL.replace(/\/$/, "")}${ENDPOINT_PATH}`;
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

  // 2) Create the schedule.
  const createRes = await fetch(
    `${QSTASH}/${encodeURIComponent(destination)}`,
    {
      method: "POST",
      headers: {
        ...auth,
        "Upstash-Cron": CRON,
        "Upstash-Method": "POST",
        // Upstash-Forward-* headers are stripped of the prefix and forwarded
        // to the destination. The bare `Authorization` header would be
        // intercepted by QStash for its own signature, hence the prefix.
        "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`,
      },
    },
  );
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
