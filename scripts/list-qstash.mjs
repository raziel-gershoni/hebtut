#!/usr/bin/env node
// One-shot diagnostic: dump every QStash schedule on this account so you can
// inspect raw destinations / scheduleIds / created-at when the dashboard UI
// shows two rows that look identical. Run with:
//
//   QSTASH_TOKEN=eyJ... node scripts/list-qstash.mjs
//   QSTASH_TOKEN=eyJ... QSTASH_URL=https://qstash-us-east-1.upstash.io node scripts/list-qstash.mjs
//
// Prints a compact summary, then the raw JSON. Compare the two duplicate
// rows side-by-side to find what diverged (trailing slash, scheme, port,
// header drift). Read-only — never modifies QStash state.

const { QSTASH_TOKEN, QSTASH_URL } = process.env;
const QSTASH = `${(QSTASH_URL ?? "https://qstash.upstash.io").replace(/\/$/, "")}/v2/schedules`;

if (!QSTASH_TOKEN) {
  console.error("QSTASH_TOKEN not set in env");
  process.exit(1);
}

const r = await fetch(QSTASH, { headers: { Authorization: `Bearer ${QSTASH_TOKEN}` } });
if (!r.ok) {
  console.error(`list failed: ${r.status} ${await r.text()}`);
  process.exit(1);
}
const list = await r.json();
if (!Array.isArray(list)) {
  console.log("non-array payload:", JSON.stringify(list, null, 2));
  process.exit(0);
}

console.log(`Found ${list.length} schedule(s):\n`);
for (const s of list) {
  console.log(`  scheduleId : ${s.scheduleId}`);
  console.log(`  destination: ${JSON.stringify(s.destination)}`);
  console.log(`  cron       : ${s.cron}`);
  console.log(`  createdAt  : ${s.createdAt ?? "?"}`);
  console.log(`  method     : ${s.method ?? "?"}`);
  if (s.header) console.log(`  headers    : ${JSON.stringify(s.header)}`);
  console.log("");
}

console.log("---\nRaw JSON:\n");
console.log(JSON.stringify(list, null, 2));
