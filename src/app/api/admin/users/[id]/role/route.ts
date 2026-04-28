import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import type { UserRole } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    role: z.enum(["pending", "student", "teacher"]).optional(),
    is_admin: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.is_admin !== undefined, {
    message: "must provide role and/or is_admin",
  });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: target } = await sb
    .from("users")
    .select("role, is_admin")
    .eq("id", targetId)
    .single();
  if (!target) return new Response("not found", { status: 404 });

  // If we're changing role and that breaks an existing student/teacher pairing,
  // drop the relevant links so the trigger doesn't reject reads later.
  if (parsed.data.role !== undefined && target.role !== parsed.data.role) {
    if (target.role === "student" || parsed.data.role === "student") {
      await sb.from("student_teachers").delete().eq("student_id", targetId);
    }
    if (target.role === "teacher" || parsed.data.role === "teacher") {
      await sb.from("student_teachers").delete().eq("teacher_id", targetId);
    }
  }

  const update: { role?: UserRole; is_admin?: boolean; role_changed_at?: string } = {};
  if (parsed.data.role !== undefined) {
    update.role = parsed.data.role;
    update.role_changed_at = new Date().toISOString();
  }
  if (parsed.data.is_admin !== undefined) {
    update.is_admin = parsed.data.is_admin;
  }

  const { error } = await sb.from("users").update(update).eq("id", targetId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}
