import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "media-library";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) return new Response("forbidden", { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response("bad id", { status: 400 });

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
