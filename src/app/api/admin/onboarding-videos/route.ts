import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STEPS: readonly OnboardingVideoStep[] = ["video1", "video2", "video3"] as const;

type Slot =
  | { step: OnboardingVideoStep; present: false }
  | {
      step: OnboardingVideoStep;
      present: true;
      original_filename: string;
      mime_type: string;
      bytes: number;
      duration_seconds: number | null;
      uploaded_at: string;
      uploaded_by_user_id: number;
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
      "step, original_filename, mime_type, bytes, duration_seconds, uploaded_at, uploaded_by_user_id",
    );
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  const byStep = new Map<OnboardingVideoStep, (typeof rows)[number]>();
  for (const r of rows ?? []) byStep.set(r.step as OnboardingVideoStep, r);

  const slots: Slot[] = STEPS.map((step) => {
    const r = byStep.get(step);
    if (!r) return { step, present: false };
    return {
      step,
      present: true,
      original_filename: r.original_filename,
      mime_type: r.mime_type,
      bytes: r.bytes,
      duration_seconds: r.duration_seconds,
      uploaded_at: r.uploaded_at,
      uploaded_by_user_id: r.uploaded_by_user_id,
    };
  });

  return Response.json({ slots }, { headers: noStoreHeaders });
}
