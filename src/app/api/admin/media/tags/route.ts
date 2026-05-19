import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TagWithCount {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  usage_count: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: tags, error } = await sb
    .from("media_tags")
    .select("id, name, slug, created_at")
    .order("name", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  const { data: links } = await sb.from("media_library_tag_links").select("tag_id");
  const usage = new Map<number, number>();
  for (const l of links ?? []) {
    usage.set(l.tag_id, (usage.get(l.tag_id) ?? 0) + 1);
  }

  const out: TagWithCount[] = (tags ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    created_at: t.created_at,
    usage_count: usage.get(t.id) ?? 0,
  }));
  return Response.json({ tags: out }, { headers: noStoreHeaders });
}

const PostBody = z.object({
  name: z.string().min(1).max(40),
});

export async function POST(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = PostBody.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const name = parsed.data.name.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > 40) {
    return new Response("bad name", { status: 400, headers: noStoreHeaders });
  }
  const slug = slugify(name);
  if (!slug) {
    return new Response("bad slug", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const { data: existing } = await sb
    .from("media_tags")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    return Response.json(
      { error: "duplicate", tag: existing },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const { data: inserted, error } = await sb
    .from("media_tags")
    .insert({ name, slug, created_by_user_id: me.id })
    .select("id, name, slug, created_at")
    .single();
  if (error || !inserted) {
    return new Response(error?.message ?? "insert failed", {
      status: 500,
      headers: noStoreHeaders,
    });
  }

  await recordAudit({
    action: "media.tag_create",
    actorId: me.id,
    subjectType: "media_tag",
    subjectId: inserted.id,
    meta: { name, slug },
  });

  return Response.json({ tag: inserted }, { status: 201, headers: noStoreHeaders });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
