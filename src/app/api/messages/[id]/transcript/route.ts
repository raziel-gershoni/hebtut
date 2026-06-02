import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  text: z.string().trim().min(1).max(5000),
});

/**
 * Edit an existing transcript on an outbound voice/video_note message.
 *
 * Auth: admin OR the teacher who originally sent the audio. Mirrors the
 * other message-action gates in this codebase.
 *
 * Telegram side: tries `editMessageText` on the original transcript
 * follow-up. If TG refuses (48-hour edit window, message deleted,
 * etc.), falls back to a fresh threaded "Поправка: ..." message and
 * updates `transcript_tg_message_id` to point at the new message so a
 * subsequent edit targets the correction.
 *
 * DB side: always updates `transcript_text` and (if fallback) the new
 * `transcript_tg_message_id`. Audit row captures from/to lengths plus
 * which path was taken.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const newText = parsed.data.text;

  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select(
      "id, student_id, teacher_id, direction, kind, transcript_text, transcript_tg_message_id, translation_text, translation_tg_message_id, tg_message_id_in_student_chat",
    )
    .eq("id", id)
    .maybeSingle();
  if (!msg) {
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  }
  if (
    msg.direction !== "out" ||
    !(msg.kind === "voice" || msg.kind === "video_note") ||
    msg.transcript_text == null
  ) {
    return new Response("no transcript", { status: 400, headers: noStoreHeaders });
  }
  if (!user.isAdmin && msg.teacher_id !== user.id) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  if (newText === msg.transcript_text) {
    return Response.json(
      { ok: true, transcript_text: newText, fallback: false, unchanged: true },
      { headers: noStoreHeaders },
    );
  }

  const { data: student } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("id", msg.student_id)
    .single();
  if (!student?.tg_chat_id) {
    return new Response("no chat", { status: 502, headers: noStoreHeaders });
  }

  // Transcript + translation now live in a single combined TG message
  // («transcript\n\ntranslation»). Editing transcript means rebuilding
  // that combined body with the new transcript + the (unchanged)
  // translation, and editing the same message.
  const combinedBody = msg.translation_text
    ? `${newText}\n\n${msg.translation_text}`
    : newText;

  let fallback = false;
  let newTgMessageId: number | null = msg.transcript_tg_message_id;
  if (msg.transcript_tg_message_id != null) {
    try {
      await getBot().api.editMessageText(
        student.tg_chat_id,
        msg.transcript_tg_message_id,
        combinedBody,
        { entities: [{ type: "spoiler", offset: 0, length: combinedBody.length }] },
      );
    } catch (e) {
      console.warn(
        "[transcript-edit] editMessageText refused, falling back",
        (e as Error).message,
      );
      fallback = true;
    }
  } else {
    // No prior transcript message id (shouldn't happen because the toggle
    // gate writes one on success, but be defensive for rows written before
    // the column existed). Treat as fallback path.
    fallback = true;
  }

  if (fallback) {
    try {
      const fallbackBody = `${ru.bot.transcripts.correctionPrefix}${combinedBody}`;
      const sent = await getBot().api.sendMessage(
        student.tg_chat_id,
        fallbackBody,
        {
          ...(msg.tg_message_id_in_student_chat != null
            ? {
                reply_parameters: {
                  message_id: msg.tg_message_id_in_student_chat,
                  allow_sending_without_reply: true,
                },
              }
            : {}),
          entities: [{ type: "spoiler", offset: 0, length: fallbackBody.length }],
        },
      );
      newTgMessageId = sent.message_id;
    } catch (e) {
      console.warn(
        "[transcript-edit] correction-send failed",
        (e as Error).message,
      );
      return new Response("tg send failed", { status: 502, headers: noStoreHeaders });
    }
  }

  // Both message_id columns repoint to the same TG message (either the
  // edited original or the new fallback). Keeps the two edit endpoints
  // symmetric.
  const { error: updErr } = await sb
    .from("messages")
    .update({
      transcript_text: newText,
      transcript_tg_message_id: newTgMessageId,
      translation_tg_message_id: msg.translation_text ? newTgMessageId : null,
    })
    .eq("id", id);
  if (updErr) {
    return new Response(updErr.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "message.transcript_edit",
    actorId: user.id,
    subjectType: "message",
    subjectId: id,
    meta: {
      from_length: msg.transcript_text.length,
      to_length: newText.length,
      fallback,
    },
  });

  return Response.json(
    { ok: true, transcript_text: newText, fallback },
    { headers: noStoreHeaders },
  );
}
