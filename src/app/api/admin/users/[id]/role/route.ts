import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ role: z.enum(["pending", "student", "teacher", "admin"]) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: target } = await sb.from("users").select("role").eq("id", targetId).single();
  if (target && target.role !== parsed.data.role) {
    // Drop links if either side of the role pair becomes invalid.
    if (target.role === "student" || parsed.data.role === "student") {
      await sb.from("student_teachers").delete().eq("student_id", targetId);
    }
    if (target.role === "teacher" || parsed.data.role === "teacher") {
      await sb.from("student_teachers").delete().eq("teacher_id", targetId);
    }
  }

  const { error } = await sb
    .from("users")
    .update({ role: parsed.data.role, role_changed_at: new Date().toISOString() })
    .eq("id", targetId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}
