import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { MAX_BYTES, extFromMime } from "@/lib/media";
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("bad form", { status: 400, headers: noStoreHeaders });
  }
  const fileField = form.get("file");
  if (!(fileField instanceof File)) {
    return new Response("file required", { status: 400, headers: noStoreHeaders });
  }
  const file = fileField;
  if (!VIDEO_MIMES.has(file.type)) {
    return new Response("unsupported mime", { status: 415, headers: noStoreHeaders });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return new Response("file too large", { status: 413, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const { data: existing } = await sb
    .from("onboarding_videos")
    .select("storage_path")
    .eq("step", step)
    .maybeSingle();

  const ext = extFromMime(file.type);
  const newPath = `onboarding/${step}-${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(newPath, bytes, { contentType: file.type, upsert: false });
  if (uploadErr) {
    return new Response(uploadErr.message, { status: 500, headers: noStoreHeaders });
  }

  // Upsert by step PK. tg_file_id is cleared so the next bot send re-captures
  // a fresh one against the new bytes.
  const { error: upsertErr } = await sb.from("onboarding_videos").upsert(
    {
      step,
      storage_path: newPath,
      mime_type: file.type,
      original_filename: file.name,
      bytes: file.size,
      tg_file_id: null,
      tg_file_unique_id: null,
      uploaded_by_user_id: me.id,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "step" },
  );
  if (upsertErr) {
    await sb.storage.from(BUCKET).remove([newPath]);
    return new Response(upsertErr.message, { status: 500, headers: noStoreHeaders });
  }

  // Drop the prior object only after the new row points elsewhere.
  if (existing && existing.storage_path !== newPath) {
    await sb.storage.from(BUCKET).remove([existing.storage_path]);
  }

  await recordAudit({
    action: "onboarding.video_upload",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    meta: { step, bytes: file.size, mime: file.type, replaced: !!existing },
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
