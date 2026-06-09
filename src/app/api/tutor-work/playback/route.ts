import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { validatePlayback } from "@/server/tutor-work-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  messageId: z.coerce.number().int(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
});

/**
 * POST /api/tutor-work/playback
 *
 * Logs a tutor's playback of an inbound student voice/video_note in the
 * Mini App. Validated server-side: message must exist, be inbound, of a
 * playable kind, the tutor must be linked to the student, and the
 * playback window must overlap an existing 'active' heartbeat.
 *
 * Always returns 200 — failures are silently dropped (logged server-side)
 * so the UX doesn't show errors for what is otherwise an analytics signal.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!user || (user.role !== "teacher" && !user.isAdmin)) {
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }

  const { messageId } = parsed.data;
  const started_at = new Date(parsed.data.started_at);
  const ended_at = new Date(parsed.data.ended_at);

  const sb = getServiceRoleClient();

  const { data: msg } = await sb
    .from("messages")
    .select("id, direction, kind, duration, student_id")
    .eq("id", messageId)
    .maybeSingle();

  let tutorIsLinkedToStudent = false;
  if (msg) {
    if (user.isAdmin) {
      tutorIsLinkedToStudent = true;
    } else {
      const { data: link } = await sb
        .from("student_teachers")
        .select("teacher_id")
        .eq("student_id", msg.student_id)
        .eq("teacher_id", user.id)
        .maybeSingle();
      tutorIsLinkedToStudent = !!link;
    }
  }

  // Pull active windows that *could* overlap. Cheap range filter.
  const { data: actives } = await sb
    .from("tutor_work_events")
    .select("started_at, ended_at")
    .eq("tutor_id", user.id)
    .eq("kind", "active")
    .gte("ended_at", started_at.toISOString())
    .lte("started_at", ended_at.toISOString());

  const result = validatePlayback({
    message: msg as
      | {
          id: number;
          direction: "in" | "out";
          kind: "voice" | "video_note" | "text";
          duration: number;
          student_id: number;
        }
      | null,
    tutorIsLinkedToStudent,
    activeWindows: (actives ?? []).map((a) => ({
      started_at: new Date(a.started_at),
      ended_at: new Date(a.ended_at),
    })),
    started_at,
    ended_at,
  });

  if (!result.ok) {
    console.warn("[tutor-work/playback] dropped", {
      reason: result.reason,
      tutor_id: user.id,
      messageId,
    });
    return Response.json({ ok: false }, { status: 200, headers: noStoreHeaders });
  }

  const { error } = await sb.from("tutor_work_events").insert({
    tutor_id: user.id,
    kind: "playback",
    started_at: result.started_at.toISOString(),
    ended_at: result.ended_at.toISOString(),
    ref_id: result.student_id,
    source: "playback_provider",
  });
  if (error) {
    console.warn("[tutor-work/playback] insert failed", {
      tutor_id: user.id,
      messageId,
      err: error.message,
    });
  }
  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
