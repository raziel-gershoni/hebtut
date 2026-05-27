import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Drains queued teacher-initiated messages whose response window has now
 * opened. Each row sends the voice/video to the student's chat, then
 * inserts the corresponding `messages` row with status='answered' and
 * the resulting tg_message_id_in_student_chat. Failure is recorded on
 * the row but never throws — the next tick retries.
 *
 * Runs every minute via QStash. The DUE index keeps the query trivial.
 */
async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await sb
    .from("scheduled_outbound")
    .select("*")
    .eq("status", "queued")
    .lte("deliver_at", nowIso)
    .limit(100);

  if (!due?.length) return Response.json({ delivered: 0, failed: 0, skipped: 0 });

  const bot = getBot();
  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    // Atomic claim. The UPDATE only succeeds if status is still 'queued'
    // (i.e. no concurrent cron tick or prior failed-but-stuck send is
    // already handling this row). Without this gate, a successful TG
    // send followed by a failed status writeback would let the next
    // cron tick re-send the SAME video to the student — confirmed
    // repro: students were getting the same video on every minute tick.
    const { data: claimed } = await sb
      .from("scheduled_outbound")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      skipped++;
      continue;
    }

    try {
      let tgMessageId: number;
      let newFileId = row.file_id;
      let newFileUniqueId: string | null = null;
      if (row.kind === "voice") {
        const sent = await bot.api.sendVoice(row.tg_chat_id, row.file_id);
        tgMessageId = sent.message_id;
        newFileId = sent.voice?.file_id ?? row.file_id;
        newFileUniqueId = sent.voice?.file_unique_id ?? null;
      } else {
        const sent = await bot.api.sendVideoNote(row.tg_chat_id, row.file_id);
        tgMessageId = sent.message_id;
        newFileId = sent.video_note?.file_id ?? row.file_id;
        newFileUniqueId = sent.video_note?.file_unique_id ?? null;
      }
      const { data: outRow } = await sb
        .from("messages")
        .insert({
          student_id: row.student_id,
          direction: "out",
          teacher_id: row.teacher_id,
          kind: row.kind,
          file_id: newFileId,
          file_unique_id: newFileUniqueId,
          duration: row.duration,
          status: "answered",
          reply_to_id: row.original_message_id,
          tg_message_id_in_student_chat: tgMessageId,
        })
        .select("id")
        .single();
      await sb
        .from("scheduled_outbound")
        .update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await recordAudit({
        action: "message.out",
        actorId: row.teacher_id,
        subjectType: "message",
        subjectId: outRow?.id ?? null,
        meta: {
          kind: row.kind,
          duration: row.duration,
          student_id: row.student_id,
          via: "scheduled_outbound",
          scheduled_id: row.id,
        },
      });
      delivered++;
    } catch (e) {
      failed++;
      // Roll the claim forward to 'failed' so subsequent ticks skip it.
      // If THIS update itself fails, the row stays in 'sending' (still
      // safe — claim gate keeps the next tick from re-sending) and an
      // admin can manually inspect.
      await sb
        .from("scheduled_outbound")
        .update({ status: "failed" })
        .eq("id", row.id);
      console.warn("scheduled delivery failed", {
        id: row.id,
        reason: (e as Error).message,
      });
    }
  }

  return Response.json({ delivered, failed, skipped });
}

export { handler as GET, handler as POST };
