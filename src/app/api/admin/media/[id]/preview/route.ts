import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { signedLibraryMediaUrl } from "@/server/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two modes:
 * - default: 302 redirect to the presigned R2 GET URL — used by `<img>` and
 *   `<audio>` tags where one round-trip is preferable.
 * - `?as=json`: returns `{ signedUrl }` instead. iOS WebKit (Mini App
 *   webview) is flaky with `<video>` + 302 redirect + cross-origin range
 *   requests; the JSON path lets the client fetch the URL up-front and
 *   point `<video src>` at it directly.
 *
 * R2-only: if presigning throws (e.g. R2NotConfiguredError) this 502s rather
 * than falling back to a Supabase URL — fail-loud by design.
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

  // Presigned R2 GET URL — the object lives in a private R2 bucket. If R2 is
  // unconfigured / signing fails this throws and we 502 (no Supabase fallback).
  let signedUrl: string;
  try {
    signedUrl = await signedLibraryMediaUrl(row.storage_path);
  } catch {
    return new Response("no url", { status: 502 });
  }

  if (asJson) {
    return Response.json({ signedUrl }, { headers: noStoreHeaders });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: signedUrl,
      // Don't let the browser cache the redirect past the presigned URL's TTL —
      // a cached 302 pointing at an expired signature would 403. Short window
      // is enough to coalesce the rapid double-GET media elements sometimes do.
      "Cache-Control": "private, max-age=60",
    },
  });
}
