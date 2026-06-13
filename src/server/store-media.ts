import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { uploadStudentMedia } from "@/server/media-storage";
import { oggOpusToCaf, OggCafError } from "@/lib/ogg-to-caf";
import { logSystem } from "@/server/system-log";

/** Lowercased extension of a TG file_path ("voice/file_1.oga" → "oga"). */
export function extFromTgFilePath(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "bin";
  return base.slice(dot + 1).toLowerCase();
}

const CONTENT_TYPE: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** R2 serves objects (incl. via presigned GET) with the content-type they were
 * uploaded with, so setting this correctly is what fixes WebKit's "won't sniff
 * octet-stream" problem that forced the proxy. */
export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export interface StorableMessage {
  id: number;
  student_id: number;
  kind: string;
  file_id: string;
}

/**
 * Download a message's media from Telegram once and persist it in the private
 * R2 bucket. Voice additionally gets a lossless CAF remux for pre-18.4 WebKit.
 * Stamps storage_path/_caf_path/stored_at under a `storage_path IS NULL` guard
 * (idempotent + race-safe). Throws on any failure so the cron can count + log.
 */
export async function storeMessageMedia(msg: StorableMessage): Promise<void> {
  const sb = getServiceRoleClient();
  const file = await getBot().api.getFile(msg.file_id);
  if (!file.file_path) throw new Error("no file_path from getFile");
  const tgUrl = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const upstream = await fetch(tgUrl);
  if (!upstream.ok) throw new Error(`tg fetch ${upstream.status}`);
  const bytes = new Uint8Array(await upstream.arrayBuffer());

  const ext = extFromTgFilePath(file.file_path);
  const base = `${msg.student_id}/${crypto.randomUUID()}`;
  const origPath = `${base}.${ext}`;
  await uploadStudentMedia(origPath, bytes, contentTypeForExt(ext));

  let cafPath: string | null = null;
  if (msg.kind === "voice") {
    try {
      const caf = oggOpusToCaf(bytes);
      cafPath = `${base}.caf`;
      await uploadStudentMedia(cafPath, caf, "audio/x-caf");
    } catch (e) {
      if (!(e instanceof OggCafError)) throw e;
      cafPath = null;
      await logSystem("warn", "store-media", "caf remux failed; ogg only", {
        message_id: msg.id,
        reason: e.message,
      });
    }
  }

  const { error } = await sb
    .from("messages")
    .update({
      storage_path: origPath,
      storage_caf_path: cafPath,
      stored_at: new Date().toISOString(),
    })
    .eq("id", msg.id)
    .is("storage_path", null);
  if (error) throw new Error(`row update failed: ${error.message}`);

  await logSystem("info", "store-media", "stored message media", {
    message_id: msg.id,
    kind: msg.kind,
    path: origPath,
    bytes: bytes.length,
    caf: cafPath != null,
  });
}
