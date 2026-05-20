import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "media-library";

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
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) return new Response("forbidden", { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response("bad id", { status: 400 });
  const asJson = new URL(req.url).searchParams.get("as") === "json";

  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("media_library")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) return new Response("not found", { status: 404 });

  // Bucket is public (see 20260521000001_media_bucket_public.sql).
  // getPublicUrl just constructs the URL — no lookup, no failure mode,
  // works around the broken sign endpoint.
  const { data } = sb.storage.from(BUCKET).getPublicUrl(row.storage_path);
  const publicUrl = data.publicUrl;
  if (!publicUrl) return new Response("no url", { status: 502 });

  if (asJson) {
    return Response.json({ signedUrl: publicUrl }, { headers: noStoreHeaders });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: publicUrl,
      // Browser may cache the redirect for up to 10 min; the underlying
      // public URL is stable so re-use is fine.
      "Cache-Control": "private, max-age=600",
    },
  });
}
