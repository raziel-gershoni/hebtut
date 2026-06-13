import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { getMediaUploadsTeachersEnabled } from "@/server/settings";
import { ALLOWED_MIME_TYPES, buildStoragePath } from "@/lib/media";
import { signedLibraryPutUrl, R2NotConfiguredError } from "@/server/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  mime_type: z.string(),
});

/**
 * Returns a fresh storage path + a short-lived presigned R2 PUT URL for a
 * media-library item. The browser PUTs the bytes straight to `url` (sending a
 * matching `Content-Type` header) and then posts metadata to /api/admin/media
 * to register the row. R2-only — no Supabase fallback.
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
  try {
    const url = await signedLibraryPutUrl(path, parsed.data.mime_type);
    return Response.json({ url, path }, { headers: noStoreHeaders });
  } catch (e) {
    if (e instanceof R2NotConfiguredError) {
      return new Response("storage not configured", {
        status: 503,
        headers: noStoreHeaders,
      });
    }
    throw e;
  }
}
