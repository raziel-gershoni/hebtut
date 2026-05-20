import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { getMediaUploadsTeachersEnabled } from "@/server/settings";
import { ALLOWED_MIME_TYPES, buildStoragePath } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "media-library";

const Body = z.object({
  mime_type: z.string(),
});

/**
 * Issues a short-lived signed upload URL for a media-library item. The
 * browser PUTs the file directly to Supabase Storage (bypassing Vercel's
 * 4.5 MB function body limit), then calls /api/admin/media POST with the
 * resulting storage_path to register the metadata row.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  if (!me.isAdmin && !(await getMediaUploadsTeachersEnabled())) {
    return new Response("uploads disabled for teachers", {
      status: 403,
      headers: noStoreHeaders,
    });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success || !ALLOWED_MIME_TYPES.includes(parsed.data.mime_type)) {
    return new Response("unsupported mime", { status: 415, headers: noStoreHeaders });
  }
  const { path } = buildStoragePath(me.id, parsed.data.mime_type);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return new Response(error?.message ?? "sign failed", {
      status: 500,
      headers: noStoreHeaders,
    });
  }
  return Response.json(
    { bucket: BUCKET, path, token: data.token },
    { headers: noStoreHeaders },
  );
}
