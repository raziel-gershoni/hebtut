import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { getMediaUploadsTeachersEnabled } from "@/server/settings";
import {
  ALLOWED_MIME_TYPES,
  MAX_BYTES,
  inferKindOrThrow,
} from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LibraryItem {
  id: number;
  kind: "photo" | "video" | "audio";
  uploaded_by_user_id: number;
  storage_path: string;
  mime_type: string;
  original_filename: string;
  title: string | null;
  description: string | null;
  bytes: number;
  duration_seconds: number | null;
  tg_file_id: string | null;
  tg_file_unique_id: string | null;
  created_at: string;
  tags: { id: number; name: string; slug: string }[];
  uploader_name: string | null;
}

const BUCKET = "media-library";

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  const url = new URL(req.url);
  const tagSlugs = url.searchParams.getAll("tag").filter((s) => s.length > 0);

  const { data: rows, error } = await sb
    .from("media_library")
    .select(
      "id, kind, uploaded_by_user_id, storage_path, mime_type, original_filename, title, description, bytes, duration_seconds, tg_file_id, tg_file_unique_id, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  const ids = (rows ?? []).map((r) => r.id);
  const { data: linkRows } = ids.length
    ? await sb
        .from("media_library_tag_links")
        .select("media_library_id, tag_id")
        .in("media_library_id", ids)
    : { data: [] as { media_library_id: number; tag_id: number }[] };
  const distinctTagIds = Array.from(new Set((linkRows ?? []).map((l) => l.tag_id)));
  const { data: tagRows } = distinctTagIds.length
    ? await sb.from("media_tags").select("id, name, slug").in("id", distinctTagIds)
    : { data: [] as { id: number; name: string; slug: string }[] };
  const tagsById = new Map<number, { id: number; name: string; slug: string }>();
  for (const t of tagRows ?? []) tagsById.set(t.id, t);
  const tagsByItem = new Map<number, { id: number; name: string; slug: string }[]>();
  for (const l of linkRows ?? []) {
    const t = tagsById.get(l.tag_id);
    if (!t) continue;
    const arr = tagsByItem.get(l.media_library_id) ?? [];
    arr.push(t);
    tagsByItem.set(l.media_library_id, arr);
  }

  const uploaderIds = Array.from(new Set((rows ?? []).map((r) => r.uploaded_by_user_id)));
  const { data: uploaders } = uploaderIds.length
    ? await sb.from("users").select("id, name, preferred_name").in("id", uploaderIds)
    : { data: [] as { id: number; name: string | null; preferred_name: string | null }[] };
  const uploaderName = new Map<number, string | null>();
  for (const u of uploaders ?? []) {
    uploaderName.set(u.id, u.preferred_name ?? u.name);
  }

  const items: LibraryItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as LibraryItem["kind"],
    uploaded_by_user_id: r.uploaded_by_user_id,
    storage_path: r.storage_path,
    mime_type: r.mime_type,
    original_filename: r.original_filename,
    title: r.title,
    description: r.description,
    bytes: r.bytes,
    duration_seconds: r.duration_seconds,
    tg_file_id: r.tg_file_id,
    tg_file_unique_id: r.tg_file_unique_id,
    created_at: r.created_at,
    tags: tagsByItem.get(r.id) ?? [],
    uploader_name: uploaderName.get(r.uploaded_by_user_id) ?? null,
  }));

  const filtered =
    tagSlugs.length > 0
      ? items.filter((it) => {
          const present = new Set(it.tags.map((t) => t.slug));
          return tagSlugs.every((s) => present.has(s));
        })
      : items;

  const can_upload = me.isAdmin || (await getMediaUploadsTeachersEnabled());

  return Response.json({ items: filtered, can_upload }, { headers: noStoreHeaders });
}

// Registration body. The bytes were already uploaded directly to Supabase
// via /api/admin/media/upload-url; this endpoint just records the metadata.
const Body = z.object({
  storage_path: z.string().min(1).max(256),
  mime_type: z.string(),
  original_filename: z.string().min(1).max(255),
  bytes: z.number().int().positive().max(MAX_BYTES),
  title: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  duration_seconds: z.number().int().positive().nullable().optional(),
});

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
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const body = parsed.data;
  if (!ALLOWED_MIME_TYPES.includes(body.mime_type)) {
    return new Response("unsupported mime", { status: 415, headers: noStoreHeaders });
  }
  // Guard against a client picking arbitrary paths in the bucket. Per-user
  // prefix lines up with the path layout that /upload-url generated.
  if (!body.storage_path.startsWith(`${me.id}/`)) {
    return new Response("bad path", { status: 400, headers: noStoreHeaders });
  }
  const kind = inferKindOrThrow(body.mime_type);
  const rawTitle = (body.title ?? "").trim();
  const title =
    rawTitle.length > 0
      ? rawTitle.slice(0, 80)
      : stripExt(body.original_filename).slice(0, 80) || null;
  const rawDesc = (body.description ?? "").trim();
  const description = rawDesc.length > 0 ? rawDesc.slice(0, 500) : null;
  const tagIds = Array.from(new Set(body.tag_ids ?? []));

  const sb = getServiceRoleClient();

  // Verify the object actually exists in storage. We use `list()` (not
  // `createSignedUrl`) because the latter has been seen to return "Object
  // not found" for rows that are truly present in storage.objects — the
  // dashboard reads via list() too and shows the file fine. Using sign()
  // as the existence probe would block legitimate uploads.
  {
    const lastSlash = body.storage_path.lastIndexOf("/");
    const folder = lastSlash > 0 ? body.storage_path.slice(0, lastSlash) : "";
    const filename =
      lastSlash >= 0 ? body.storage_path.slice(lastSlash + 1) : body.storage_path;
    const { data: items, error: listErr } = await sb.storage
      .from(BUCKET)
      .list(folder, { limit: 1, search: filename });
    if (listErr || !items || items.length === 0) {
      return new Response(
        `uploaded object missing: ${listErr?.message ?? "not in list"}`,
        { status: 400, headers: noStoreHeaders },
      );
    }
  }

  const { data: inserted, error: insertErr } = await sb
    .from("media_library")
    .insert({
      kind,
      uploaded_by_user_id: me.id,
      storage_path: body.storage_path,
      mime_type: body.mime_type,
      original_filename: body.original_filename,
      title,
      description,
      bytes: body.bytes,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return new Response(insertErr?.message ?? "insert failed", {
      status: 500,
      headers: noStoreHeaders,
    });
  }

  let appliedTagIds: number[] = [];
  if (tagIds.length > 0) {
    const { data: validTags } = await sb
      .from("media_tags")
      .select("id")
      .in("id", tagIds);
    appliedTagIds = (validTags ?? []).map((t) => t.id);
    if (appliedTagIds.length > 0) {
      await sb.from("media_library_tag_links").insert(
        appliedTagIds.map((tid) => ({
          media_library_id: inserted.id,
          tag_id: tid,
          created_by_user_id: me.id,
        })),
      );
    }
  }

  await recordAudit({
    action: "media.upload",
    actorId: me.id,
    subjectType: "media_library",
    subjectId: inserted.id,
    meta: { kind, bytes: body.bytes, mime: body.mime_type, tag_ids: appliedTagIds },
  });

  return Response.json({ id: inserted.id }, { status: 201, headers: noStoreHeaders });
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
