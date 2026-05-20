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

  const { data: signed, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 900);
  if (error || !signed?.signedUrl) {
    return new Response(error?.message ?? "no url", { status: 502 });
  }

  if (asJson) {
    return Response.json(
      { signedUrl: signed.signedUrl },
      { headers: noStoreHeaders },
    );
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      // Signed URLs are good for 15 min on Supabase. Browser may keep a
      // cached redirect for up to 10 min; within that window the signed
      // URL is still valid. Beyond it, the next hit re-issues a fresh
      // redirect.
      "Cache-Control": "private, max-age=600",
    },
  });
}
