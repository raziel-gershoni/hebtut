import { InputFile } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit";

const BUCKET = "media-library";

export interface SendLibraryItemArgs {
  libraryId: number;
  studentId: number;
  teacherId: number;
}

export interface SendLibraryItemResult {
  messageId: number;
}

/**
 * Sends a media-library item to the given student's TG chat and writes a
 * mirroring `messages` row.
 *
 * First send of a library item: passes a short-lived signed Supabase URL to
 * TG's send* endpoint. TG fetches it, ingests it, and returns its own
 * `file_id`. We cache that `file_id` on the library row so every subsequent
 * send (to any student) is a single TG-internal reference — no Supabase
 * round-trip, no re-upload.
 *
 * Mirrors the structure of `teacher-reply.ts`'s relay block: insert the
 * messages row, refresh the (S,T) claim, audit. Intentionally skips the
 * onboarding-first-reply advancement and the `editAllNotificationsForMessage`
 * branch — library sends are fresh top-level notes, not swipe-replies to an
 * inbound prompt.
 */
export async function sendLibraryItemToStudent(
  args: SendLibraryItemArgs,
): Promise<SendLibraryItemResult> {
  const sb = getServiceRoleClient();
  const bot = getBot();

  const { data: library } = await sb
    .from("media_library")
    .select(
      "id, kind, storage_path, mime_type, original_filename, title, description, bytes, duration_seconds, width, height, tg_file_id, tg_file_unique_id",
    )
    .eq("id", args.libraryId)
    .maybeSingle();
  if (!library) throw new Error("library item not found");

  const { data: student } = await sb
    .from("users")
    .select("id, role, tg_chat_id, status")
    .eq("id", args.studentId)
    .maybeSingle();
  if (!student) throw new Error("student not found");
  if (student.role !== "student") throw new Error("not a student");

  // On the first send for a library item we forward bytes as multipart
  // (`InputFile`) rather than handing TG the Supabase public URL. TG used
  // to reject some URL-based sends with "wrong type of the web page
  // content" — happens when the storage object's MIME doesn't satisfy
  // TG's strict per-method check (e.g. octet-stream for a video, or an
  // HTML error page on intermittent fetch failures). Multipart bypasses
  // all that. Once TG ingests the bytes it returns a `file_id` which we
  // cache below for instantaneous subsequent sends.
  let sendArg: string | InputFile;
  if (library.tg_file_id) {
    sendArg = library.tg_file_id;
  } else {
    // Bucket is public — getPublicUrl just constructs the URL.
    // Works around the broken sign endpoint (see migration 20260521000001).
    const { data } = sb.storage.from(BUCKET).getPublicUrl(library.storage_path);
    if (!data.publicUrl) {
      throw new Error("could not construct public storage URL");
    }
    sendArg = new InputFile(new URL(data.publicUrl));
  }

  let newFileId: string | null = null;
  let newFileUniqueId: string | null = null;
  let sentMessageId: number;
  if (library.kind === "photo") {
    const sent = await bot.api.sendPhoto(student.tg_chat_id, sendArg);
    const largest = sent.photo[sent.photo.length - 1];
    newFileId = largest?.file_id ?? library.tg_file_id ?? null;
    newFileUniqueId = largest?.file_unique_id ?? library.tg_file_unique_id ?? null;
    sentMessageId = sent.message_id;
  } else if (library.kind === "video") {
    // Explicit width/height + duration + supports_streaming stop TG from
    // defaulting to a 320×320 square preview when it can't infer aspect
    // ratio from the container. Dimensions are probed client-side at
    // upload time via probeVideoMetadata. Once TG has ingested the bytes
    // with these hints, the cached tg_file_id preserves the correct
    // rendering for every subsequent send.
    const sent = await bot.api.sendVideo(student.tg_chat_id, sendArg, {
      duration: library.duration_seconds ?? undefined,
      width: library.width ?? undefined,
      height: library.height ?? undefined,
      supports_streaming: true,
    });
    newFileId = sent.video?.file_id ?? library.tg_file_id ?? null;
    newFileUniqueId = sent.video?.file_unique_id ?? library.tg_file_unique_id ?? null;
    sentMessageId = sent.message_id;
  } else {
    const sent = await bot.api.sendAudio(student.tg_chat_id, sendArg);
    newFileId = sent.audio?.file_id ?? library.tg_file_id ?? null;
    newFileUniqueId = sent.audio?.file_unique_id ?? library.tg_file_unique_id ?? null;
    sentMessageId = sent.message_id;
  }

  if (!library.tg_file_id && newFileId) {
    await sb
      .from("media_library")
      .update({ tg_file_id: newFileId, tg_file_unique_id: newFileUniqueId })
      .eq("id", library.id);
  }

  if (!newFileId) {
    throw new Error("TG did not return a file_id");
  }

  const { data: outRow, error: insertErr } = await sb
    .from("messages")
    .insert({
      student_id: student.id,
      direction: "out",
      teacher_id: args.teacherId,
      kind: library.kind,
      file_id: newFileId,
      file_unique_id: newFileUniqueId,
      duration: library.duration_seconds ?? 0,
      status: "answered",
      tg_message_id_in_student_chat: sentMessageId,
      media_library_id: library.id,
    })
    .select("id")
    .single();
  if (insertErr || !outRow) {
    throw new Error(insertErr?.message ?? "messages insert failed");
  }

  await recordAudit({
    action: "message.out",
    actorId: args.teacherId,
    subjectType: "message",
    subjectId: outRow.id,
    meta: {
      kind: library.kind,
      student_id: student.id,
      media_library_id: library.id,
      source: "library",
    },
  });

  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await sb.from("claims").upsert(
    {
      student_id: student.id,
      teacher_id: args.teacherId,
      claimed_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "student_id" },
  );
  await recordAudit({
    action: "claim.refresh",
    actorId: args.teacherId,
    subjectType: "claim",
    subjectId: student.id,
    meta: { kind: "media-library-send", expires_at: expiresAt },
  });

  return { messageId: outRow.id };
}

