import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listAllR2Objects } from "@/server/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Mirror of the store-media cron's abandon threshold: a message that has failed
// this many stores is given up on (stays on the proxy) and never lands in R2.
const MAX_STORE_ATTEMPTS = 5;

const PAGE = 1000;

/**
 * Paginate a Supabase select to completion (keyset by id) so a growing table
 * can never silently truncate the audit. `page(from,to)` must apply an
 * `.order("id").range(from,to)` so successive pages are disjoint + ordered.
 */
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * READ-ONLY storage audit, BOTH directions. Does NOT delete or mutate anything.
 *
 * Bucket → owning DB columns:
 *   student-media (R2_BUCKET)            ← messages.storage_path + storage_caf_path
 *   media-library (R2_MEDIA_LIBRARY...)  ← media_library.storage_path
 *                                          + onboarding_videos.storage_path
 *
 * Forward (R2 → DB) = `orphans`: objects in a bucket with no row pointing at
 * them (leaked uploads). Safe-to-delete candidates.
 *
 * Reverse (DB → R2): rows that expect a media object which isn't in the bucket,
 * classified by actual blast radius:
 *   - messages: served from R2 only when r2_migrated; a missing object DEGRADES
 *     to the /api/media TG proxy (soft). `dangling_refs` = primary object gone;
 *     `caf_only_missing` = only the old-WebKit CAF remux gone (ogg still plays).
 *     `unstored_*` = inbound media not yet in R2 — `stuck` (gave up after
 *     MAX_STORE_ATTEMPTS) vs `pending` (next cron tick stores it).
 *   - media_library / onboarding_videos: the bot SEND reuses a cached
 *     `tg_file_id` and never reads R2, but the Mini App preview/thread embed
 *     presigns R2 unconditionally (no fallback). So a migrated row whose object
 *     is gone is `dangling_broken` (tg_file_id null → unserveable everywhere) or
 *     `dangling_cached` (tg_file_id present → only Mini App breaks). `unmigrated`
 *     = r2_migrated=false rows the migrate-library-r2 backfill hasn't copied yet
 *     (self-healing; should be 0 once migration is complete).
 *
 * Ordering note: R2 is listed BEFORE the DB is read on purpose. That makes the
 * forward (orphan) snapshot conservative — a row written between the two reads
 * is still caught, so a live object is never mis-flagged as a deletable orphan.
 * The trade is that `dangling`/`unstored` counts can include up to ~1 store-cron
 * cycle of in-flight rows; small transient non-zero values there are expected —
 * re-run to confirm before treating them as real loss.
 *
 * CRON_SECRET-gated (ops tool, no admin UI). Curl:
 *   curl -X POST .../api/admin/r2-orphans -H "Authorization: Bearer $CRON_SECRET"
 */
async function handler(req: NextRequest): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const sum = (a: { size: number }[]) => a.reduce((s, o) => s + o.size, 0);
  const mb = (n: number) => Math.round((n / (1024 * 1024)) * 100) / 100;

  try {
    // === student-media bucket ================================================
    const studentBucket = serverEnv.R2_BUCKET ?? "";
    const studentObjs = await listAllR2Objects(studentBucket);
    const studentKeys = new Set(studentObjs.map((o) => o.key));

    // Rows that point at a student-media object (either path non-null) — used for
    // BOTH the forward valid-set and the reverse dangling check.
    const pathRows = await fetchAll<{
      id: number;
      storage_path: string | null;
      storage_caf_path: string | null;
      r2_migrated: boolean;
    }>("messages path", (f, t) =>
      sb
        .from("messages")
        .select("id, storage_path, storage_caf_path, r2_migrated")
        .not("storage_path", "is", null)
        .order("id", { ascending: true })
        .range(f, t),
    );

    // Forward: objects with no row referencing them.
    const studentValid = new Set<string>();
    for (const m of pathRows) {
      if (m.storage_path) studentValid.add(m.storage_path);
      if (m.storage_caf_path) studentValid.add(m.storage_caf_path);
    }
    const studentOrphans = studentObjs.filter((o) => !studentValid.has(o.key));

    // Reverse (dangling): only r2_migrated rows are served from R2; un-migrated
    // rows still serve via proxy and aren't expected in R2.
    const danglingRefs: { id: number; missing: string }[] = [];
    let cafOnlyMissing = 0;
    for (const m of pathRows) {
      if (!m.r2_migrated) continue;
      const pathMissing = !!m.storage_path && !studentKeys.has(m.storage_path);
      const cafMissing = !!m.storage_caf_path && !studentKeys.has(m.storage_caf_path);
      if (pathMissing) {
        danglingRefs.push({ id: m.id, missing: m.storage_path as string });
      } else if (cafMissing) {
        cafOnlyMissing++;
      }
    }

    // Reverse (unstored): inbound media not yet in R2 (mirrors the store-media
    // cron's queue predicate, minus the store_attempts cap so we can split).
    const unstoredRows = await fetchAll<{ id: number; kind: string; store_attempts: number | null }>(
      "messages unstored",
      (f, t) =>
        sb
          .from("messages")
          .select("id, kind, store_attempts")
          .not("file_id", "is", null)
          .eq("r2_migrated", false)
          .is("media_library_id", null)
          .order("id", { ascending: true })
          .range(f, t),
    );
    const unstoredStuck = unstoredRows.filter((r) => (r.store_attempts ?? 0) >= MAX_STORE_ATTEMPTS);
    const unstoredPending = unstoredRows.filter((r) => (r.store_attempts ?? 0) < MAX_STORE_ATTEMPTS);

    // === media-library bucket (media_library + onboarding_videos) ===========
    const libBucket = serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "";
    const libObjs = await listAllR2Objects(libBucket);
    const libKeys = new Set(libObjs.map((o) => o.key));

    const libRows = await fetchAll<{
      id: number;
      storage_path: string | null;
      kind: string;
      r2_migrated: boolean;
      tg_file_id: string | null;
    }>("media_library", (f, t) =>
      sb
        .from("media_library")
        .select("id, storage_path, kind, r2_migrated, tg_file_id")
        .order("id", { ascending: true })
        .range(f, t),
    );
    const onbRows = await fetchAll<{
      id: number;
      step: string;
      position: number;
      storage_path: string | null;
      r2_migrated: boolean;
      tg_file_id: string | null;
    }>("onboarding_videos", (f, t) =>
      sb
        .from("onboarding_videos")
        .select("id, step, position, storage_path, r2_migrated, tg_file_id")
        .order("id", { ascending: true })
        .range(f, t),
    );

    // Forward: objects with no row referencing them. The valid-set spans ALL
    // rows regardless of r2_migrated — media-library reuses the storage_path key
    // verbatim on copy, so an un-migrated row's key is the same key the object
    // will land at; counting it never falsely orphans a live object.
    const libValid = new Set<string>();
    for (const r of libRows) if (r.storage_path) libValid.add(r.storage_path);
    for (const r of onbRows) if (r.storage_path) libValid.add(r.storage_path);
    const libOrphans = libObjs.filter((o) => !libValid.has(o.key));

    // Reverse: split missing-object rows by migration state + tg cache.
    type LibLike = { id: number; storage_path: string | null; r2_migrated: boolean; tg_file_id: string | null };
    const classifyMissing = (rows: LibLike[]) => {
      const missing = rows.filter((r) => r.storage_path && !libKeys.has(r.storage_path));
      const migrated = missing.filter((r) => r.r2_migrated);
      return {
        dangling_broken: migrated.filter((r) => !r.tg_file_id), // unserveable everywhere
        dangling_cached: migrated.filter((r) => !!r.tg_file_id), // Mini App breaks; bot send ok
        unmigrated: missing.filter((r) => !r.r2_migrated), // backfill cron will copy
      };
    };
    const libClass = classifyMissing(libRows);
    const onbClass = classifyMissing(onbRows);

    return Response.json({
      notes: [
        "read-only audit; nothing deleted or mutated",
        "R2 listed before DB read → orphans are safe-to-delete; dangling/unstored may include ~1 cron-cycle of in-flight rows",
      ],
      student_media: {
        bucket: studentBucket,
        total_objects: studentObjs.length,
        // forward (R2 → DB)
        referenced: studentObjs.length - studentOrphans.length,
        orphans: studentOrphans.length,
        orphan_mb: mb(sum(studentOrphans)),
        orphan_sample: studentOrphans.slice(0, 25).map((o) => o.key),
        // reverse (DB → R2) — messages degrade to the TG proxy (soft)
        dangling_refs: danglingRefs.length,
        dangling_sample: danglingRefs.slice(0, 25),
        caf_only_missing: cafOnlyMissing,
        unstored_stuck: unstoredStuck.length,
        unstored_pending: unstoredPending.length,
        unstored_stuck_sample: unstoredStuck
          .slice(0, 25)
          .map((r) => ({ id: r.id, kind: r.kind, attempts: r.store_attempts ?? 0 })),
      },
      media_library: {
        bucket: libBucket,
        total_objects: libObjs.length,
        // forward (R2 → DB)
        referenced: libObjs.length - libOrphans.length,
        orphans: libOrphans.length,
        orphan_mb: mb(sum(libOrphans)),
        orphan_sample: libOrphans.slice(0, 25).map((o) => o.key),
        // reverse (DB → R2)
        dangling_broken: libClass.dangling_broken.length, // no tg cache → unserveable everywhere
        dangling_cached: libClass.dangling_cached.length, // tg cache → only Mini App preview breaks
        unmigrated: libClass.unmigrated.length, // r2_migrated=false → backfill pending
        dangling_sample: [...libClass.dangling_broken, ...libClass.dangling_cached]
          .slice(0, 25)
          .map((r) => ({ id: r.id, path: r.storage_path, has_tg_cache: !!r.tg_file_id })),
      },
      onboarding_videos: {
        // shares the media-library bucket
        dangling_broken: onbClass.dangling_broken.length,
        dangling_cached: onbClass.dangling_cached.length,
        unmigrated: onbClass.unmigrated.length,
        dangling_sample: [...onbClass.dangling_broken, ...onbClass.dangling_cached]
          .slice(0, 25)
          .map((r) => ({ id: r.id, path: r.storage_path, has_tg_cache: !!r.tg_file_id })),
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export { handler as GET, handler as POST };
