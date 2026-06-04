import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  tagIds: z.array(z.coerce.number().int().positive()).max(40),
});

/**
 * Auth: admin OR the teacher linked to this student via student_teachers.
 * Returns 403 if the caller is a non-admin teacher with no link.
 */
async function authorize(
  req: NextRequest,
  studentId: number,
): Promise<{ user: { id: number; isAdmin: boolean }; sb: ReturnType<typeof getServiceRoleClient> } | Response> {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  if (!user.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) {
      return new Response("forbidden", { status: 403, headers: noStoreHeaders });
    }
  }
  return { user: { id: user.id, isAdmin: user.isAdmin }, sb };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const studentId = Number(params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const auth = await authorize(req, studentId);
  if (auth instanceof Response) return auth;
  const { sb } = auth;

  const { data: links } = await sb
    .from("user_tag_links")
    .select("tag_id, media_tags(id, name, slug)")
    .eq("user_id", studentId);

  const tags = (links ?? []).flatMap((l) => {
    const tag = l.media_tags as unknown as { id: number; name: string; slug: string } | null;
    return tag ? [tag] : [];
  });
  tags.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return Response.json({ tags }, { headers: noStoreHeaders });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const studentId = Number(params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const auth = await authorize(req, studentId);
  if (auth instanceof Response) return auth;
  const { user, sb } = auth;

  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const wantedIds = Array.from(new Set(parsed.data.tagIds));

  const { data: currentRows } = await sb
    .from("user_tag_links")
    .select("tag_id")
    .eq("user_id", studentId);
  const currentIds = new Set((currentRows ?? []).map((r) => r.tag_id));
  const wantedSet = new Set(wantedIds);

  const toAdd = wantedIds.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wantedSet.has(id));

  if (toAdd.length > 0) {
    // Validate that every wanted tag id actually exists in the dictionary
    // — prevents a stale frontend from creating FK violations.
    const { data: existing } = await sb
      .from("media_tags")
      .select("id")
      .in("id", toAdd);
    const valid = new Set((existing ?? []).map((t) => t.id));
    const filtered = toAdd.filter((id) => valid.has(id));
    if (filtered.length > 0) {
      const { error } = await sb.from("user_tag_links").insert(
        filtered.map((tagId) => ({
          user_id: studentId,
          tag_id: tagId,
          created_by_user_id: user.id,
        })),
      );
      if (error) {
        return new Response(error.message, { status: 500, headers: noStoreHeaders });
      }
    }
  }

  if (toRemove.length > 0) {
    const { error } = await sb
      .from("user_tag_links")
      .delete()
      .eq("user_id", studentId)
      .in("tag_id", toRemove);
    if (error) {
      return new Response(error.message, { status: 500, headers: noStoreHeaders });
    }
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await recordAudit({
      action: "user.tags_update",
      actorId: user.id,
      subjectType: "user",
      subjectId: studentId,
      meta: { added: toAdd, removed: toRemove },
    });
  }

  return Response.json({ ok: true, added: toAdd, removed: toRemove }, { headers: noStoreHeaders });
}
