import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({ studentId: z.coerce.number().int() });

/**
 * Mark the (current teacher, given student) chat as read at "now". Powers
 * the unread_count in the inbox. Fire-and-forget on the client.
 */
export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  await sb
    .from("inbox_reads")
    .upsert(
      {
        teacher_id: user.id,
        student_id: parsed.data.studentId,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "teacher_id,student_id" },
    );
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
