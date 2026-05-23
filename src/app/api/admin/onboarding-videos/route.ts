import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STEPS: readonly OnboardingVideoStep[] = ["video1", "video2", "video3"] as const;

type Clip = {
  id: number;
  position: number;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  bytes: number;
  duration_seconds: number | null;
  uploaded_at: string;
  uploaded_by_user_id: number;
};

type Slot = {
  step: OnboardingVideoStep;
  clips: Clip[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("onboarding_videos")
    .select(
      "id, step, position, storage_path, original_filename, mime_type, bytes, duration_seconds, uploaded_at, uploaded_by_user_id",
    )
    .order("step", { ascending: true })
    .order("position", { ascending: true });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  const byStep = new Map<OnboardingVideoStep, Clip[]>();
  for (const step of STEPS) byStep.set(step, []);
  for (const r of rows ?? []) {
    const list = byStep.get(r.step as OnboardingVideoStep);
    if (!list) continue;
    list.push({
      id: r.id,
      position: r.position,
      storage_path: r.storage_path,
      original_filename: r.original_filename,
      mime_type: r.mime_type,
      bytes: r.bytes,
      duration_seconds: r.duration_seconds,
      uploaded_at: r.uploaded_at,
      uploaded_by_user_id: r.uploaded_by_user_id,
    });
  }
  const slots: Slot[] = STEPS.map((step) => ({
    step,
    clips: byStep.get(step) ?? [],
  }));
  return Response.json({ slots }, { headers: noStoreHeaders });
}
