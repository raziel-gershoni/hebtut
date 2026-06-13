#!/usr/bin/env node
// Create QStash schedules for our cron endpoints on first production deploy.
// Idempotent: each schedule is matched by URL pathname (so hostname/scheme
// drift across deploys doesn't spawn duplicates), and existing schedules at
// the same path are left alone — manually-created schedules survive.
// Failures never block the build — claim expiry / subscription tick degrade
// gracefully without the cron, see INFRA.md §5.

const TAG = "[qstash-sync]";

const {
  QSTASH_TOKEN,
  QSTASH_URL,
  APP_BASE_URL,
  CRON_SECRET,
  VERCEL_ENV,
} = process.env;

// Add new entries here when a new cron endpoint is introduced. Each schedule
// is independently matched + created; failure on one doesn't block the others.
const SCHEDULES = [
  { path: "/api/cron/expire-claims", cron: "*/5 * * * *" },
  // Subscription tick: trial→trial_expired, active→lapsed, frozen→active,
  // and 24h-pre / day-of renewal reminders. Hourly is enough — quota state
  // is read on every inbound event so a few-minute lag in the canonical
  // status flip is invisible to users.
  { path: "/api/cron/subscriptions", cron: "0 * * * *" },
  // Scheduled-outbound delivery: drains teacher-initiated messages that
  // were held while the student's response window was closed. Once a
  // minute keeps the apparent latency low when the window opens.
  { path: "/api/cron/deliver-scheduled", cron: "*/1 * * * *" },
  // Onboarding tree: drains due nudges / explainer / conversion CTA /
  // survey / churn-followup timers, plus the day-2+ inactivity sweep.
  // Once-a-minute matches the bot's reactive cadence — within ~60s a
  // student who paused 6h ago gets the gentle nudge.
  { path: "/api/cron/onboarding", cron: "*/1 * * * *" },
  // Store-once media: downloads un-stored inbound voice/video_note from TG into
  // Supabase so the client serves them straight from the CDN (zero Vercel
  // egress). First runs after deploy drain the existing backlog; steady-state
  // stores new media within ~60s (proxy fallback covers the gap).
  { path: "/api/cron/store-media", cron: "*/1 * * * *" },
  { path: "/api/cron/engagement", cron: "0 6 * * *" }, // daily ~09:00 Israel
];

const QSTASH = `${(QSTASH_URL ?? "https://qstash.upstash.io").replace(/\/$/, "")}/v2/schedules`;

async function main() {
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

  let base = APP_BASE_URL.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const auth = { Authorization: `Bearer ${QSTASH_TOKEN}` };

  // List once; reuse for every schedule's match check below.
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

  for (const { path, cron } of SCHEDULES) {
    await syncOne({ path, cron, base, schedules, auth });
  }
}

async function syncOne({ path, cron, base, schedules, auth }) {
  const destination = `${base}${path}`;

  // Match by URL pathname, not full string equality — see comment in the
  // earlier single-schedule version of this file. Path-based match makes the
  // matcher robust to hostname/scheme drift.
  const matches = schedules.filter((s) => {
    if (typeof s?.destination !== "string") return false;
    try {
      const p = new URL(s.destination).pathname.replace(/\/$/, "");
      return p === path;
    } catch {
      return false;
    }
  });
  if (matches.length > 0) {
    if (matches.length > 1) {
      console.warn(
        `${TAG} found ${matches.length} schedules at ${path} — duplicates in QStash. Delete extras manually:\n` +
          matches
            .map(
              (m) =>
                `  - id=${m.scheduleId} cron=${m.cron} destination=${m.destination} createdAt=${m.createdAt ?? "?"}`,
            )
            .join("\n"),
      );
    } else {
      console.log(
        `${TAG} ${path}: schedule already present (id=${matches[0].scheduleId}, cron=${matches[0].cron}) — not modifying`,
      );
    }
    return;
  }

  // Create. Destination URL goes directly into the path — NOT URL-encoded.
  // QStash's router treats the path opaquely; encoded URLs are rejected.
  const createRes = await fetch(`${QSTASH}/${destination}`, {
    method: "POST",
    headers: {
      ...auth,
      "Upstash-Cron": cron,
      "Upstash-Method": "POST",
      // Upstash-Forward-* prefix is stripped before forwarding; the bare
      // Authorization header would be intercepted by QStash's own auth.
      "Upstash-Forward-Authorization": `Bearer ${process.env.CRON_SECRET}`,
    },
  });
  if (!createRes.ok) {
    console.warn(
      `${TAG} ${path}: create failed (${createRes.status}): ${await createRes.text()}`,
    );
    return;
  }
  const body = await createRes.json().catch(() => ({}));
  console.log(
    `${TAG} ${path}: created schedule (id=${body?.scheduleId ?? "?"}, cron=${cron}) → ${destination}`,
  );
}

main().catch((e) => {
  console.warn(`${TAG} error: ${e?.message ?? e}`);
});
