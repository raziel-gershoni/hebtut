import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { signStorageUrlRaw } from "@/lib/storage-sign";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "media-library";
const VALID: ReadonlySet<OnboardingVideoStep> = new Set([
  "video1",
  "video2",
  "video3",
]);

/**
 * Two modes:
 * - default: 302 redirect to the Supabase signed URL — used by `<img>` and
 *   `<audio>` tags where one round-trip is preferable.
 * - `?as=json`: returns `{ signedUrl }` instead. iOS WebKit (Mini App
 *   webview) is flaky with `<video>` + 302 redirect + cross-origin range
 *   requests; the JSON path lets the client fetch the URL up-front and
 *   point `<video src>` at it directly.
 */
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
  const asJson = new URL(req.url).searchParams.get("as") === "json";

  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("onboarding_videos")
    .select("storage_path")
    .eq("step", step)
    .maybeSingle();
  if (!row) return new Response("not found", { status: 404 });

  // SDK path first. If it returns "Object not found" for a row that
  // demonstrably exists in storage.objects, fall back to the raw REST call.
  let signedUrl: string | null = null;
  let lastErr: string | null = null;
  const { data: sdkSigned, error: sdkErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 900);
  if (sdkSigned?.signedUrl && !sdkErr) {
    signedUrl = sdkSigned.signedUrl;
  } else {
    lastErr = `sdk: ${sdkErr?.message ?? "no url"}`;
    const fallback = await signStorageUrlRaw(BUCKET, row.storage_path, 900);
    if (fallback.signedUrl) {
      signedUrl = fallback.signedUrl;
    } else {
      lastErr += ` | raw: ${fallback.status} ${fallback.bodyText.slice(0, 200)}`;
    }
  }

  if (!signedUrl) {
    return new Response(lastErr ?? "no url", { status: 502 });
  }

  if (asJson) {
    return Response.json({ signedUrl }, { headers: noStoreHeaders });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: signedUrl,
      "Cache-Control": "private, max-age=600",
    },
  });
}
