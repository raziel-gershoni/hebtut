import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listAllR2Objects } from "@/server/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * READ-ONLY orphan audit: lists each R2 bucket and diffs the object keys against
 * the DB rows that should reference them, reporting how many objects have no
 * corresponding row (and their total bytes). Does NOT delete anything.
 *
 * Bucket → owning DB columns:
 *   student-media (R2_BUCKET)            ← messages.storage_path + storage_caf_path
 *   media-library (R2_MEDIA_LIBRARY...)  ← media_library.storage_path
 *                                          + onboarding_videos.storage_path
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

  // --- student-media ---
  const studentBucket = serverEnv.R2_BUCKET ?? "";
  const studentObjs = await listAllR2Objects(studentBucket);
  const { data: msgRows, error: msgErr } = await sb
    .from("messages")
    .select("storage_path, storage_caf_path")
    .not("storage_path", "is", null);
  if (msgErr) return Response.json({ error: "messages query failed" }, { status: 500 });
  const studentValid = new Set<string>();
  for (const m of msgRows ?? []) {
    if (m.storage_path) studentValid.add(m.storage_path);
    if (m.storage_caf_path) studentValid.add(m.storage_caf_path);
  }
  const studentOrphans = studentObjs.filter((o) => !studentValid.has(o.key));

  // --- media-library (shared by media_library + onboarding_videos) ---
  const libBucket = serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "";
  const libObjs = await listAllR2Objects(libBucket);
  const { data: libRows } = await sb.from("media_library").select("storage_path");
  const { data: onbRows } = await sb.from("onboarding_videos").select("storage_path");
  const libValid = new Set<string>();
  for (const r of libRows ?? []) if (r.storage_path) libValid.add(r.storage_path);
  for (const r of onbRows ?? []) if (r.storage_path) libValid.add(r.storage_path);
  const libOrphans = libObjs.filter((o) => !libValid.has(o.key));

  return Response.json({
    student_media: {
      bucket: studentBucket,
      total_objects: studentObjs.length,
      referenced: studentObjs.length - studentOrphans.length,
      orphans: studentOrphans.length,
      orphan_mb: mb(sum(studentOrphans)),
      orphan_sample: studentOrphans.slice(0, 25).map((o) => o.key),
    },
    media_library: {
      bucket: libBucket,
      total_objects: libObjs.length,
      referenced: libObjs.length - libOrphans.length,
      orphans: libOrphans.length,
      orphan_mb: mb(sum(libOrphans)),
      orphan_sample: libOrphans.slice(0, 25).map((o) => o.key),
    },
  });
}

export { handler as GET, handler as POST };
