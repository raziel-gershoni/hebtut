import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { MAX_BYTES } from "@/lib/media";
import { signStorageUrlRaw } from "@/lib/storage-sign";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "media-library";
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
// via /upload-url; the server's job here is just to record where they live
// and clean up any prior object for this slot.
const Body = z.object({
  storage_path: z.string().min(1).max(256),
  mime_type: z.string(),
  original_filename: z.string().min(1).max(255),
  bytes: z.number().int().positive().max(MAX_BYTES),
  duration_seconds: z.number().int().positive().nullable().optional(),
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

  // Verify the object actually exists in storage. SDK first; if SDK
  // returns "Object not found" for a row that's really there, the raw
  // REST call may still succeed (the SDK has been seen to fail on rows
  // created via signed-upload-URL). Only block registration if BOTH
  // paths agree the object is missing.
  const sdkVerify = await sb.storage.from(BUCKET).createSignedUrl(storage_path, 60);
  if (sdkVerify.error) {
    const rawVerify = await signStorageUrlRaw(BUCKET, storage_path, 60);
    if (!rawVerify.signedUrl) {
      return new Response(
        `uploaded object missing: ${sdkVerify.error.message} | raw: ${rawVerify.status} ${rawVerify.bodyText.slice(0, 120)}`,
        { status: 400, headers: noStoreHeaders },
      );
    }
  }

  const { data: existing } = await sb
    .from("onboarding_videos")
    .select("storage_path")
    .eq("step", step)
    .maybeSingle();

  // Upsert by step PK. tg_file_id is cleared so the next bot send re-captures
  // a fresh one against the new bytes.
  const { error: upsertErr } = await sb.from("onboarding_videos").upsert(
    {
      step,
      storage_path,
      mime_type,
      original_filename,
      bytes,
      tg_file_id: null,
      tg_file_unique_id: null,
      uploaded_by_user_id: me.id,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "step" },
  );
  if (upsertErr) {
    return new Response(upsertErr.message, { status: 500, headers: noStoreHeaders });
  }

  // Drop the prior object only after the new row points elsewhere.
  if (existing && existing.storage_path !== storage_path) {
    await sb.storage.from(BUCKET).remove([existing.storage_path]);
  }

  await recordAudit({
    action: "onboarding.video_upload",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: { step, bytes, mime: mime_type, replaced: !!existing },
  });

  return Response.json({ ok: true }, { status: 201, headers: noStoreHeaders });
}

export async function DELETE(
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
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("onboarding_videos")
    .select("storage_path")
    .eq("step", step)
    .maybeSingle();
  if (!row) {
    return Response.json({ ok: true }, { headers: noStoreHeaders });
  }
  await sb.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await sb.from("onboarding_videos").delete().eq("step", step);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  await recordAudit({
    action: "onboarding.video_delete",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: { step },
  });
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
