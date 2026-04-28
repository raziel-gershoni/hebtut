import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  studentId: z.coerce.number().int(),
  teacherId: z.coerce.number().int(),
});

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const sb = getServiceRoleClient();
  const { error } = await sb.from("student_teachers").insert({
    student_id: parsed.data.studentId,
    teacher_id: parsed.data.teacherId,
  });
  if (error) return new Response(error.message, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("student_teachers")
    .delete()
    .eq("student_id", parsed.data.studentId)
    .eq("teacher_id", parsed.data.teacherId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}
