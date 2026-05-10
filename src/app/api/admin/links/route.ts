import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  studentId: z.coerce.number().int(),
  teacherId: z.coerce.number().int(),
});

interface JoinedLinkRow {
  student_id: number;
  teacher_id: number;
  created_at: string;
  student: { name: string | null } | null;
  teacher: { name: string | null } | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("student_teachers")
    .select(
      "student_id, teacher_id, created_at, student:student_id(name), teacher:teacher_id(name)",
    )
    // Recency-first so the new bulk-pairing UI's existing-links view shows
    // the just-created links at the top after a "Связать" tap.
    .order("created_at", { ascending: false });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  const rows = (data ?? []) as unknown as JoinedLinkRow[];
  const links = rows.map((r) => ({
    student_id: r.student_id,
    teacher_id: r.teacher_id,
    student_name: r.student?.name ?? null,
    teacher_name: r.teacher?.name ?? null,
    created_at: r.created_at,
  }));
  return Response.json({ links }, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { error } = await sb.from("student_teachers").insert({
    student_id: parsed.data.studentId,
    teacher_id: parsed.data.teacherId,
  });
  if (error) {
    return new Response(error.message, { status: 400, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "admin.link_create",
    actorId: user.id,
    subjectType: "link",
    meta: { student_id: parsed.data.studentId, teacher_id: parsed.data.teacherId },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}

export async function DELETE(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("student_teachers")
    .delete()
    .eq("student_id", parsed.data.studentId)
    .eq("teacher_id", parsed.data.teacherId);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "admin.link_delete",
    actorId: user.id,
    subjectType: "link",
    meta: { student_id: parsed.data.studentId, teacher_id: parsed.data.teacherId },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
