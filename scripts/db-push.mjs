#!/usr/bin/env node
// Apply Supabase migrations at deploy time without going through the
// Supabase CLI. Reason: the CLI uses pgx with prepared-statement caching,
// which collides with Supavisor pooler statement names ("prepared statement
// 'lrupsc_1_0' already exists"). The postgres lib lets us connect with
// `prepare: false` and use the simple query protocol throughout.
//
// Local dev can keep using `supabase db push` (`pnpm db:push`) — that path
// is fine when going through Direct Connection (IPv6).

import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TAG = "[db-push]";
const { SUPABASE_DB_URL } = process.env;

if (!SUPABASE_DB_URL) {
  console.error(`${TAG} SUPABASE_DB_URL is not set`);
  process.exit(1);
}

const MIGRATIONS_DIR = "supabase/migrations";

// Connect with `prepare: false` so postgres-js uses the simple query
// protocol and never asks the server to allocate a named prepared
// statement. `max: 1` keeps us pinned to a single backend connection
// across the whole migration run.
const sql = postgres(SUPABASE_DB_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 10,
  connection: { application_name: "hebtutbot-migrator" },
});

try {
  // Tracking table mirrors the Supabase CLI's so the two flows stay
  // compatible if someone runs `supabase db push` later.
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);

  const applied = await sql`
    select version from supabase_migrations.schema_migrations
  `;
  const appliedSet = new Set(applied.map((r) => r.version));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = file.split("_")[0];
    if (!/^\d+$/.test(version)) {
      console.warn(`${TAG} skip ${file} (no numeric version prefix)`);
      continue;
    }
    if (appliedSet.has(version)) {
      console.log(`${TAG} skip ${version} (already applied)`);
      continue;
    }
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const body = await readFile(fullPath, "utf8");
    console.log(`${TAG} applying ${version} (${file})`);

    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values (${version}, ${file}, ${[body]})
      `;
    });
    appliedCount += 1;
  }

  console.log(`${TAG} done — applied ${appliedCount} migration(s)`);
} catch (e) {
  console.error(`${TAG} failed:`, e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
