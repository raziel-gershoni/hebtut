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
 * Edit an existing Russian translation on an outbound voice/video_note
 * message. Mirrors /api/messages/[id]/transcript but writes the
 * `translation_*` columns and uses translation-flavoured prefixes.
 *
 * Auth: admin OR the teacher who originally sent the audio.
 *
 * Telegram side: tries `editMessageText` on the original translation
 * follow-up. On TG refusal (48-hour edit window, message deleted, etc.),
 * falls back to a fresh threaded «📝 Поправка перевода: ...» message and
 * repoints `translation_tg_message_id` so a subsequent edit targets the
 * correction.
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
    msg.translation_text == null
  ) {
    return new Response("no translation", { status: 400, headers: noStoreHeaders });
  }
  if (!user.isAdmin && msg.teacher_id !== user.id) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  if (newText === msg.translation_text) {
    return Response.json(
      { ok: true, translation_text: newText, fallback: false, unchanged: true },
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

  // Translation lives inside the same combined TG message as the
  // transcript («transcript\n\ntranslation»). Editing translation means
  // rebuilding the body with the (unchanged) transcript + the new
  // translation, then editing the shared message.
  const combinedBody = msg.transcript_text
    ? `${msg.transcript_text}\n\n${newText}`
    : newText;

  // Prefer the shared message id (== transcript_tg_message_id) when
  // present; defensively fall back to the legacy translation_tg_message_id
  // for rows written before the combine refactor.
  const editTargetId =
    msg.translation_tg_message_id ?? msg.transcript_tg_message_id;

  let fallback = false;
  let newTgMessageId: number | null = editTargetId;
  if (editTargetId != null) {
    try {
      await getBot().api.editMessageText(
        student.tg_chat_id,
        editTargetId,
        combinedBody,
        { entities: [{ type: "spoiler", offset: 0, length: combinedBody.length }] },
      );
    } catch (e) {
      console.warn(
        "[translation-edit] editMessageText refused, falling back",
        (e as Error).message,
      );
      fallback = true;
    }
  } else {
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
        "[translation-edit] correction-send failed",
        (e as Error).message,
      );
      return new Response("tg send failed", { status: 502, headers: noStoreHeaders });
    }
  }

  // Both columns repoint to the same target so the next edit (from
  // either endpoint) hits the latest message.
  const { error: updErr } = await sb
    .from("messages")
    .update({
      translation_text: newText,
      transcript_tg_message_id: newTgMessageId,
      translation_tg_message_id: newTgMessageId,
    })
    .eq("id", id);
  if (updErr) {
    return new Response(updErr.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "message.translation_edit",
    actorId: user.id,
    subjectType: "message",
    subjectId: id,
    meta: {
      from_length: msg.translation_text.length,
      to_length: newText.length,
      fallback,
    },
  });

  return Response.json(
    { ok: true, translation_text: newText, fallback },
    { headers: noStoreHeaders },
  );
}
