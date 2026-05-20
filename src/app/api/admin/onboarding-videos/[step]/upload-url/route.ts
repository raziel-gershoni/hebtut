import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { extFromMime } from "@/lib/media";
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

const Body = z.object({
  mime_type: z.string(),
});

/**
 * Returns a fresh storage path for an onboarding video slot. The browser
 * then uploads via TUS (through /api/admin/upload-proxy) to that path
 * and finally posts metadata to the parent POST route to register the row.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { step: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const step = VALID_STEPS.has(params.step as OnboardingVideoStep)
    ? (params.step as OnboardingVideoStep)
    : null;
  if (!step) {
    return new Response("bad step", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success || !VIDEO_MIMES.has(parsed.data.mime_type)) {
    return new Response("unsupported mime", { status: 415, headers: noStoreHeaders });
  }
  const ext = extFromMime(parsed.data.mime_type);
  const path = `onboarding/${step}-${crypto.randomUUID()}.${ext}`;
  return Response.json({ bucket: BUCKET, path }, { headers: noStoreHeaders });
}
