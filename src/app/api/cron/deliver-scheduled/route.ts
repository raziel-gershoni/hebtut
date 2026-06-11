import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { recordAudit } from "@/server/audit";
import { nextWindowOpen } from "@/server/response-window";
import {
  transcribeAndDeliverFor,
  type TranscriptDeliveryInput,
} from "@/server/transcript-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Transcription runs inline after the sends (Gemini transcribe + translate
// are up to 25s each) — the default 10s cap would kill it. Mirrors the
// /api/webhook ceiling.
export const maxDuration = 60;

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
  // Transcription is deferred until every due row is delivered — getting
  // the audio out is the critical path; transcripts are best-effort. If
  // the function dies mid-transcription, deliveries are already committed
  // and only the tail transcripts are lost.
  const toTranscribe: TranscriptDeliveryInput[] = [];

  for (const row of due) {
    // Defensive recheck against the live subscription window. The
    // PATCH-side cascade in /api/student/response-window is the primary
    // mechanism that keeps deliver_at in sync, but anything that
    // updates the subscriptions row without going through PATCH
    // (admin DB edit, future surface, race with cron) would leave the
    // row with a stale deliver_at. If the live window says "not now",
    // push the row forward and let a later tick handle it; otherwise
    // fall through to the existing send path.
    const { data: sub } = await sb
      .from("subscriptions")
      .select("response_window_start, response_window_end, response_window_tz")
      .eq("user_id", row.student_id)
      .maybeSingle();
    const now = new Date();
    const nextOpen = sub
      ? nextWindowOpen(
          now,
          sub.response_window_start,
          sub.response_window_end,
          sub.response_window_tz,
        )
      : null;
    if (nextOpen && nextOpen.getTime() > now.getTime()) {
      await sb
        .from("scheduled_outbound")
        .update({ deliver_at: nextOpen.toISOString() })
        .eq("id", row.id)
        .eq("status", "queued");
      skipped++;
      continue;
    }

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
      if (outRow?.id != null) {
        toTranscribe.push({
          messageId: outRow.id,
          studentId: row.student_id,
          teacherId: row.teacher_id,
          studentChatId: row.tg_chat_id,
          audioTgMessageId: tgMessageId,
          fileId: newFileId,
          kind: row.kind === "voice" ? "voice" : "video_note",
        });
      }
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

  // Same post-delivery tail as the immediate webhook path: transcript +
  // translation DM'd to the student, persisted on the messages row,
  // failures journaled. Never throws. Before this, scheduled messages
  // shipped permanently without transcripts — the cron simply never
  // called the transcriber.
  let transcribed = 0;
  for (const input of toTranscribe) {
    const result = await transcribeAndDeliverFor(input);
    if (result) transcribed++;
  }

  return Response.json({ delivered, failed, skipped, transcribed });
}

export { handler as GET, handler as POST };
