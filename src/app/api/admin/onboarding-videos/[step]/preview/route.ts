import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "media-library";
const VALID: ReadonlySet<OnboardingVideoStep> = new Set([
  "video1",
  "video2",
  "video3",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: { step: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) return new Response("forbidden", { status: 403 });

  if (!VALID.has(params.step as OnboardingVideoStep)) {
    return new Response("bad step", { status: 400 });
  }
  const step = params.step as OnboardingVideoStep;

  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("onboarding_videos")
    .select("storage_path")
    .eq("step", step)
    .maybeSingle();
  if (!row) return new Response("not found", { status: 404 });

  const { data: signed, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 900);
  if (error || !signed?.signedUrl) {
    return new Response(error?.message ?? "no url", { status: 502 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      "Cache-Control": "private, max-age=600",
    },
  });
}
