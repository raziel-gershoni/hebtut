"use client";

// Browser upload helpers. Two paths:
//
// 1. putToPresignedUrl — single PUT straight to a presigned URL (Cloudflare R2).
//    Used by the media-library uploader: the browser talks directly to R2 (CORS
//    must allow the PUT), no Vercel hop, so it sidesteps the 4.5 MB function
//    body limit. No resume (single shot) — accepted for ≤50 MB admin uploads.
//
// 2. tusUpload — Supabase TUS resumable upload, still used by onboarding-videos.
//    Why TUS there: Supabase recommends it for files >6 MB; it chunks (4 MB,
//    under Vercel's 4.5 MB body limit) through our /api/admin/upload-proxy route
//    (which validates admin via OUR JWT, then forwards each chunk with the
//    service-role key), and resumes from the last confirmed chunk on a blip.

import * as tus from "tus-js-client";

export interface UploadOptions {
  bucket: string;
  path: string;
  jwt: string;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Uploads a file via TUS to our /api/admin/upload-proxy endpoint, which
 * forwards to Supabase Storage. Resolves on success, throws on failure.
 * After this resolves, call the server's registration endpoint with
 * `storage_path: options.path` to record the metadata row.
 *
 * Reliability within one call:
 * - 7 attempts per chunk (immediate + 6 backoff delays: 1s, 3s, 5s, 10s,
 *   20s). On a single chunk that's ~40 s of total trying before giving
 *   up; on a multi-chunk upload it's per-chunk so the total cap depends
 *   on file size.
 * - 4 MB chunks keep each PATCH small enough to complete within typical
 *   cellular stability windows.
 *
 * Cross-session resume is NOT enabled. We'd need to coordinate the
 * storage_path between the initial call and the resumed call (otherwise
 * the resumed file lands at the original session's path while we
 * register the new path — exactly the split-brain we just fixed). If
 * users start hitting "all 7 attempts failed" regularly we'll add it,
 * but it costs a server-side path-cache + client-side state machine.
 * For now, a final failure means clicking "Загрузить" again and starting
 * over.
 */
/**
 * Single PUT of a File to a presigned R2 URL (no resume, no proxy hop). The
 * `Content-Type` sent here MUST match the type the URL was signed with —
 * R2 rejects a mismatch with a SignatureDoesNotMatch error, and a matching
 * header is also what makes R2 store the right content-type for playback.
 *
 * Uses XMLHttpRequest (not fetch) so `upload.onprogress` can drive a progress
 * bar. Resolves on a 2xx, rejects otherwise (incl. network errors / aborts).
 */
export async function putToPresignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`PUT failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.onabort = () => reject(new Error("upload aborted"));
    xhr.send(file);
  });
}

export async function tusUpload(file: File, options: UploadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: "/api/admin/upload-proxy/resumable",
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      // 4 MB chunks — Vercel functions cap request body at 4.5 MB. Each
      // chunk is a separate PATCH so total file size is unbounded.
      chunkSize: 4 * 1024 * 1024,
      removeFingerprintOnSuccess: true,
      headers: {
        Authorization: `Bearer ${options.jwt}`,
      },
      metadata: {
        bucketName: options.bucket,
        objectName: options.path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (err) => {
        console.warn("tus upload error", err);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
      onProgress: (loaded, total) => {
        options.onProgress?.(loaded, total);
      },
      onSuccess: () => {
        resolve();
      },
    });
    upload.start();
  });
}
