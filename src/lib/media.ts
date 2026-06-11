import type { MediaKind } from "@/types/database";

export const MAX_BYTES = 50 * 1024 * 1024;

// Server-enforced cap on the media-library item title (the POST schema in
// /api/admin/media uses this). Shared so the upload dialog can clamp the
// auto-seeded title to the same limit instead of letting an over-long
// value reach the server and bounce as "bad body".
export const MAX_TITLE_LEN = 80;

export const MIME_TO_KIND: Record<string, MediaKind> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/x-m4a": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
};

export const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_KIND);

export function inferKindOrThrow(mime: string): MediaKind {
  const kind = MIME_TO_KIND[mime];
  if (!kind) throw new Error("unsupported mime");
  return kind;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

export function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export function buildStoragePath(uploaderId: number, mime: string): { path: string; ext: string } {
  const ext = extFromMime(mime);
  return { path: `${uploaderId}/${crypto.randomUUID()}.${ext}`, ext };
}

/**
 * Seed value for the upload dialog's "title" field, derived from the
 * picked file's name: drop the last extension and clamp to MAX_TITLE_LEN.
 * The clamp is load-bearing — the dialog pre-fills this programmatically,
 * and the input's maxLength only limits keyboard entry, so an over-long
 * filename would otherwise reach the server and be rejected as "bad body".
 */
export function deriveTitleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.slice(0, MAX_TITLE_LEN);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
