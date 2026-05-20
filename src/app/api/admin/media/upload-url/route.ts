import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
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
 * Returns a fresh storage path for a media-library item. The browser then
 * uploads via TUS (through /api/admin/upload-proxy) to that path and
 * finally posts metadata to /api/admin/media to register the row.
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
  return Response.json({ bucket: BUCKET, path }, { headers: noStoreHeaders });
}
