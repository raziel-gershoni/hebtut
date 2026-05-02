import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru, formatDuration } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "@/server/notifications";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }

  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  // Atomic delete + return — we get one row per expired session.
  const { data: expired } = await sb
    .from("claims")
    .delete()
    .lt("expires_at", nowIso)
    .select("student_id, teacher_id");

  if (!expired?.length) return Response.json({ released: 0 });

  const bot = getBot();

  for (const row of expired) {
    const { student_id, teacher_id } = row;

    // The teacher's prompts for this student's pending messages are now stale.
    const { data: pendingMsgs } = await sb
      .from("messages")
      .select("id, kind, duration")
      .eq("student_id", student_id)
      .eq("status", "pending");
    const pendingIds = (pendingMsgs ?? []).map((m) => m.id);

    if (pendingIds.length) {
      const { data: stalePrompts } = await sb
        .from("prompts")
        .select("id, tg_chat_id, tg_prompt_message_id")
        .eq("teacher_id", teacher_id)
        .in("student_message_id", pendingIds);

      for (const p of stalePrompts ?? []) {
        try {
          await bot.api.editMessageText(
            p.tg_chat_id,
            p.tg_prompt_message_id,
            ru.teacherNotificationExpired,
          );
        } catch (e) {
          console.warn("expiry editMessageText", e);
        }
      }

      // Remove the prompts so a stale swipe-reply can no longer find them.
      await sb
        .from("prompts")
        .delete()
        .eq("teacher_id", teacher_id)
        .in("student_message_id", pendingIds);

      // Restore other teachers' notifications for the student's pending
      // messages back to actionable copy. Use the anonymous handle, never
      // the real name — peer surfaces stay anonymous.
      const { data: student } = await sb
        .from("users")
        .select("tg_user_id, display_handle")
        .eq("id", student_id)
        .single();
      const studentHandle =
        student?.display_handle ?? userHandle(student?.tg_user_id ?? 0).handle;
      for (const m of pendingMsgs ?? []) {
        const kindLabel = m.kind === "voice" ? "голосовое" : "круглое видео";
        await editAllNotificationsForMessage(
          m.id,
          ru.teacherNotificationActionable(studentHandle, kindLabel, formatDuration(m.duration)),
        );
      }
    }
  }

  return Response.json({ released: expired.length });
}

export { handler as GET, handler as POST };
