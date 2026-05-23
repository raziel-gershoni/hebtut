import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { MAX_BYTES } from "@/lib/media";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "media-library";
const MAX_CLIPS_PER_STEP = 10;
const VALID_STEPS: ReadonlySet<OnboardingVideoStep> = new Set([
  "video1",
  "video2",
  "video3",
]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function parseStep(raw: string): OnboardingVideoStep | null {
  return VALID_STEPS.has(raw as OnboardingVideoStep)
    ? (raw as OnboardingVideoStep)
    : null;
}

// Registration body. The bytes were already uploaded directly to Supabase
// via /upload-url; the server's job here is just to record where they live,
// pick a position if the client didn't, and clean up any prior object for
// the same (step, position) slot if this is a Replace.
const Body = z.object({
  storage_path: z.string().min(1).max(256),
  mime_type: z.string(),
  original_filename: z.string().min(1).max(255),
  bytes: z.number().int().positive().max(MAX_BYTES),
  duration_seconds: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(1).max(MAX_CLIPS_PER_STEP).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { step: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const step = parseStep(params.step);
  if (!step) {
    return new Response("bad step", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const { storage_path, mime_type, original_filename, bytes } = parsed.data;
  if (!VIDEO_MIMES.has(mime_type)) {
    return new Response("unsupported mime", { status: 415, headers: noStoreHeaders });
  }
  // Guard against a client picking arbitrary paths in the bucket.
  if (!storage_path.startsWith(`onboarding/${step}-`)) {
    return new Response("bad path", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();

  // Pick the target position: explicit if supplied, otherwise max+1 (or 1
  // if the step is empty). Cap at MAX_CLIPS_PER_STEP server-side too.
  let position: number;
  if (parsed.data.position != null) {
    position = parsed.data.position;
  } else {
    const { data: maxRow } = await sb
      .from("onboarding_videos")
      .select("position")
      .eq("step", step)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    position = (maxRow?.position ?? 0) + 1;
  }
  if (position < 1 || position > MAX_CLIPS_PER_STEP) {
    return new Response("position out of range", { status: 400, headers: noStoreHeaders });
  }

  // Is this a Replace (existing row at this (step, position)) or a brand
  // new clip? Replace clears tg_file_id so the next bot send re-captures
  // a fresh one against the new bytes; the prior storage object is dropped
  // AFTER the row update so a transient failure can't leave us with no
  // bytes and a dangling DB row.
  const { data: existing } = await sb
    .from("onboarding_videos")
    .select("id, storage_path")
    .eq("step", step)
    .eq("position", position)
    .maybeSingle();

  if (existing) {
    const { error: updateErr } = await sb
      .from("onboarding_videos")
      .update({
        storage_path,
        mime_type,
        original_filename,
        bytes,
        tg_file_id: null,
        tg_file_unique_id: null,
        uploaded_by_user_id: me.id,
        uploaded_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateErr) {
      return new Response(updateErr.message, { status: 500, headers: noStoreHeaders });
    }
    if (existing.storage_path !== storage_path) {
      await sb.storage.from(BUCKET).remove([existing.storage_path]);
    }
  } else {
    // Cap enforcement on insert path — also enforced by CHECK in the DB.
    const { count } = await sb
      .from("onboarding_videos")
      .select("id", { count: "exact", head: true })
      .eq("step", step);
    if ((count ?? 0) >= MAX_CLIPS_PER_STEP) {
      return new Response("max clips reached", { status: 409, headers: noStoreHeaders });
    }
    const { error: insertErr } = await sb.from("onboarding_videos").insert({
      step,
      position,
      storage_path,
      mime_type,
      original_filename,
      bytes,
      tg_file_id: null,
      tg_file_unique_id: null,
      uploaded_by_user_id: me.id,
      uploaded_at: new Date().toISOString(),
    });
    if (insertErr) {
      return new Response(insertErr.message, { status: 500, headers: noStoreHeaders });
    }
  }

  await recordAudit({
    action: "onboarding.video_upload",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: { step, position, bytes, mime: mime_type, replaced: !!existing },
  });

  return Response.json({ ok: true, position }, { status: 201, headers: noStoreHeaders });
}
