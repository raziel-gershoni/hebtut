import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin, type AuthedUser } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "media-library";

const PatchBody = z.object({
  title: z.union([z.string().max(80), z.null()]).optional(),
  description: z.union([z.string().max(500), z.null()]).optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
});

interface OwnedRow {
  id: number;
  uploaded_by_user_id: number;
  storage_path: string;
  kind: "photo" | "video" | "audio";
  bytes: number;
}

type OwnedResult =
  | { kind: "error"; response: Response }
  | { kind: "ok"; me: AuthedUser; row: OwnedRow; sb: SupabaseClient<Database> };

async function loadOwned(req: NextRequest, id: number): Promise<OwnedResult> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return {
      kind: "error",
      response: new Response("forbidden", { status: 403, headers: noStoreHeaders }),
    };
  }
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("media_library")
    .select("id, uploaded_by_user_id, storage_path, kind, bytes")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return {
      kind: "error",
      response: new Response("not found", { status: 404, headers: noStoreHeaders }),
    };
  }
  if (!me.isAdmin && row.uploaded_by_user_id !== me.id) {
    return {
      kind: "error",
      response: new Response("forbidden", { status: 403, headers: noStoreHeaders }),
    };
  }
  return { kind: "ok", me, row: row as OwnedRow, sb };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const owned = await loadOwned(req, id);
  if (owned.kind === "error") return owned.response;
  const { me, sb } = owned;

  const parsed = PatchBody.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const body = parsed.data;

  const updates: { title?: string | null; description?: string | null } = {};
  const changed: string[] = [];
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    updates.title = body.title === null ? null : (body.title ?? "").trim() || null;
    changed.push("title");
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    updates.description =
      body.description === null ? null : (body.description ?? "").trim() || null;
    changed.push("description");
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await sb.from("media_library").update(updates).eq("id", id);
    if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  if (body.tag_ids !== undefined) {
    const wanted = Array.from(new Set(body.tag_ids));
    const { data: validTags } = wanted.length
      ? await sb.from("media_tags").select("id").in("id", wanted)
      : { data: [] as { id: number }[] };
    const validIds = (validTags ?? []).map((t) => t.id);
    await sb.from("media_library_tag_links").delete().eq("media_library_id", id);
    if (validIds.length > 0) {
      await sb.from("media_library_tag_links").insert(
        validIds.map((tid) => ({
          media_library_id: id,
          tag_id: tid,
          created_by_user_id: me.id,
        })),
      );
    }
    changed.push("tags");
  }

  await recordAudit({
    action: "media.update",
    actorId: me.id,
    subjectType: "media_library",
    subjectId: id,
    meta: { changed },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const owned = await loadOwned(req, id);
  if (owned.kind === "error") return owned.response;
  const { me, row, sb } = owned;

  await sb.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await sb.from("media_library").delete().eq("id", id);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  await recordAudit({
    action: "media.delete",
    actorId: me.id,
    subjectType: "media_library",
    subjectId: id,
    meta: { storage_path: row.storage_path, kind: row.kind, bytes: row.bytes },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
