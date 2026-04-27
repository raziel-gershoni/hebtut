import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { releaseClaim } from "@/server/claim";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }

  const sb = getServiceRoleClient();
  const cutoff = new Date(Date.now() - serverEnv.CLAIM_TTL_MINUTES * 60_000).toISOString();

  const { data: stale } = await sb
    .from("messages")
    .select("id, claimed_by_teacher_id")
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);

  if (!stale?.length) return Response.json({ released: 0 });

  let released = 0;
  for (const row of stale) {
    await releaseClaim(row.id);
    if (row.claimed_by_teacher_id != null) {
      const { data: prompt } = await sb
        .from("prompts")
        .select("tg_chat_id, tg_prompt_message_id")
        .eq("student_message_id", row.id)
        .eq("teacher_id", row.claimed_by_teacher_id)
        .maybeSingle();
      if (prompt) {
        try {
          await getBot().api.editMessageText(
            prompt.tg_chat_id,
            prompt.tg_prompt_message_id,
            ru.teacherNotificationExpired,
          );
        } catch (e) {
          console.warn("expiry editMessageText", e);
        }
      }
    }
    released++;
  }
  return Response.json({ released });
}

// QStash schedules POST by default. GET kept for manual `curl` testing.
export { handler as GET, handler as POST };
