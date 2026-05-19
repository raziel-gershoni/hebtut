import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { readJsonBody } from "@/lib/http";
import { sendLibraryItemToStudent } from "@/server/handlers/media-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  student_id: z.number().int().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const studentId = parsed.data.student_id;

  const sb = getServiceRoleClient();
  if (!me.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", me.id)
      .maybeSingle();
    if (!link) {
      return new Response("forbidden", { status: 403, headers: noStoreHeaders });
    }
  }

  try {
    const { messageId } = await sendLibraryItemToStudent({
      libraryId: id,
      studentId,
      teacherId: me.id,
    });
    return Response.json({ message_id: messageId }, { headers: noStoreHeaders });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "library item not found" || msg === "student not found") {
      return new Response(msg, { status: 404, headers: noStoreHeaders });
    }
    if (msg === "not a student") {
      return new Response(msg, { status: 400, headers: noStoreHeaders });
    }
    console.error("media send failed", { libraryId: id, studentId, reason: msg });
    return new Response("send failed", { status: 502, headers: noStoreHeaders });
  }
}
