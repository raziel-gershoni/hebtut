import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { storeMessageMedia } from "@/server/store-media";
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
  const { data: rows, error } = await sb
    .from("messages")
    .select("id, student_id, kind, file_id, store_attempts")
    .not("file_id", "is", null)
    .is("storage_path", null)
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
      const attempts = (r.store_attempts ?? 0) + 1;
      await sb.from("messages").update({ store_attempts: attempts }).eq("id", r.id);
      await logSystem(
        "error",
        "store-media",
        attempts >= MAX_STORE_ATTEMPTS ? "store failed — giving up" : "store failed",
        { message_id: r.id, attempts, reason: (e as Error).message },
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
