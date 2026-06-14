import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { uploadLibraryMedia } from "@/server/media-storage";
import { logSystem } from "@/server/system-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Downloads + re-uploads up to BATCH objects per run; 60 is the Pro ceiling.
export const maxDuration = 60;

const BATCH = 25;

async function handler(req: NextRequest): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  // Work-queue: media-library rows not yet copied to R2. Oldest first so the
  // one-time backlog of existing objects drains deterministically. Additive —
  // the Supabase original is kept until a later explicit cleanup (soak window).
  const { data: rows, error } = await sb
    .from("media_library")
    .select("id, storage_path, mime_type")
    .eq("r2_migrated", false)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("[migrate-library-r2] queue query failed", error.message);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }

  let migrated = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    try {
      const { data: blob, error: dlError } = await sb.storage
        .from("media-library")
        .download(r.storage_path);
      if (dlError || !blob) {
        throw new Error(dlError?.message ?? "download returned no body");
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await uploadLibraryMedia(r.storage_path, bytes, r.mime_type);
      // Do NOT delete the Supabase object — soak window for rollback.
      await sb
        .from("media_library")
        .update({ r2_migrated: true })
        .eq("id", r.id)
        .eq("r2_migrated", false);
      migrated++;
    } catch (e) {
      failed++;
      const reason = (e as Error).message;
      await logSystem("error", "migrate-library-r2", "copy failed", { id: r.id, reason });
    }
  }
  const scanned = rows?.length ?? 0;

  // Second pass: onboarding videos. They live in the SAME Supabase
  // `media-library` bucket (path prefix `onboarding/`) and reuse the SAME R2
  // media-library bucket — onboarding clips aren't PII. Mirrors the library
  // pass above: download from Supabase, re-upload to R2, flip the flag, soak.
  const { data: onboardingRows, error: onboardingError } = await sb
    .from("onboarding_videos")
    .select("id, storage_path, mime_type")
    .eq("r2_migrated", false)
    .order("id", { ascending: true })
    .limit(BATCH);
  if (onboardingError) {
    console.error("[migrate-library-r2] onboarding queue query failed", onboardingError.message);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }

  let onboardingMigrated = 0;
  let onboardingFailed = 0;
  for (const r of onboardingRows ?? []) {
    try {
      const { data: blob, error: dlError } = await sb.storage
        .from("media-library")
        .download(r.storage_path);
      if (dlError || !blob) {
        throw new Error(dlError?.message ?? "download returned no body");
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await uploadLibraryMedia(r.storage_path, bytes, r.mime_type);
      // Do NOT delete the Supabase object — soak window for rollback.
      await sb
        .from("onboarding_videos")
        .update({ r2_migrated: true })
        .eq("id", r.id)
        .eq("r2_migrated", false);
      onboardingMigrated++;
    } catch (e) {
      onboardingFailed++;
      const reason = (e as Error).message;
      await logSystem("error", "migrate-library-r2", "onboarding copy failed", {
        id: r.id,
        reason,
      });
    }
  }
  const onboardingScanned = onboardingRows?.length ?? 0;

  if (scanned > 0 || onboardingScanned > 0) {
    await logSystem("info", "migrate-library-r2", "run", {
      scanned,
      migrated,
      failed,
      onboarding_scanned: onboardingScanned,
      onboarding_migrated: onboardingMigrated,
      onboarding_failed: onboardingFailed,
    });
  }
  return Response.json({
    scanned,
    migrated,
    failed,
    onboarding_scanned: onboardingScanned,
    onboarding_migrated: onboardingMigrated,
    onboarding_failed: onboardingFailed,
  });
}

export { handler as GET, handler as POST };
