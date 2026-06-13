import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { storeMessageMedia } from "@/server/store-media";
import { R2NotConfiguredError } from "@/server/media-storage";
import { logSystem, pruneSystemLogs } from "@/server/system-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Downloads + remuxes up to BATCH files per run; 60 is the Pro ceiling.
export const maxDuration = 60;

const BATCH = 25;
// After this many failed stores a row is abandoned (stays on the proxy
// fallback) so it can't sit at the head of the oldest-first queue forever —
// the realistic trigger is a video_note over TG's ~20 MB getFile ceiling.
const MAX_STORE_ATTEMPTS = 5;

async function handler(req: NextRequest): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  await pruneSystemLogs(14);
  // Work-queue: un-stored, non-library media (library rows carry a file_id too
  // but already live in the media-library bucket). Oldest first so the backlog
  // — i.e. the one-time migration of existing messages — drains deterministically.
  // Queue on r2_migrated=false (not storage_path IS NULL): covers brand-new
  // media AND existing Supabase-stored rows being migrated to R2, and the OLD
  // Supabase cron — which watches storage_path IS NULL — can't fight over them.
  const { data: rows, error } = await sb
    .from("messages")
    .select("id, student_id, kind, file_id, store_attempts")
    .not("file_id", "is", null)
    .eq("r2_migrated", false)
    .is("media_library_id", null)
    .lt("store_attempts", MAX_STORE_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("[store-media] queue query failed", error.message);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }

  let stored = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    if (!r.file_id) continue;
    try {
      await storeMessageMedia({
        id: r.id,
        student_id: r.student_id,
        kind: r.kind,
        file_id: r.file_id,
      });
      stored++;
    } catch (e) {
      failed++;
      const reason = (e as Error).message;
      // R2-not-configured isn't the file's fault — don't burn its retry budget,
      // so once the env vars are set the row stores normally instead of being
      // stuck past MAX_STORE_ATTEMPTS. (Guards the push-before-env ordering.)
      // Typed check, not a substring match, so rewording the message can't
      // silently re-arm the footgun.
      if (e instanceof R2NotConfiguredError) {
        await logSystem("warn", "store-media", "store skipped — R2 not configured", {
          message_id: r.id,
        });
        continue;
      }
      const attempts = (r.store_attempts ?? 0) + 1;
      await sb.from("messages").update({ store_attempts: attempts }).eq("id", r.id);
      await logSystem(
        "error",
        "store-media",
        attempts >= MAX_STORE_ATTEMPTS ? "store failed — giving up" : "store failed",
        { message_id: r.id, attempts, reason },
      );
    }
  }
  const scanned = rows?.length ?? 0;
  if (scanned > 0) {
    await logSystem("info", "store-media", "run", { scanned, stored, failed });
  }
  return Response.json({ scanned, stored, failed });
}

export { handler as GET, handler as POST };
