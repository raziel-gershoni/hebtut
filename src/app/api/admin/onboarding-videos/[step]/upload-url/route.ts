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
const MAX_CLIPS_PER_STEP = 10;
const VALID_STEPS: ReadonlySet<OnboardingVideoStep> = new Set([
  "video1",
  "video2",
  "video3",
]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const Body = z.object({
  mime_type: z.string(),
  position: z.number().int().min(1).max(MAX_CLIPS_PER_STEP).optional(),
});

/**
 * Returns a fresh storage path for an onboarding video clip slot. The browser
 * then uploads via TUS (through /api/admin/upload-proxy) to that path
 * and finally posts metadata to the parent POST route to register the row.
 *
 * Path layout: `onboarding/<step>-<position>-<uuid>.<ext>`. The parent
 * POST route validates the prefix against the same (step, position) tuple.
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
  // Position is optional on the URL endpoint — if the client doesn't know
  // it yet (new clip flow) the path uses "x" as a placeholder and the
  // POST endpoint still accepts paths matching `onboarding/<step>-`.
  const positionPart =
    parsed.data.position != null ? String(parsed.data.position) : "x";
  const path = `onboarding/${step}-${positionPart}-${crypto.randomUUID()}.${ext}`;
  return Response.json({ bucket: BUCKET, path }, { headers: noStoreHeaders });
}
