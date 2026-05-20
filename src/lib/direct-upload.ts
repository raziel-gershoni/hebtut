"use client";

// Direct-to-Supabase-Storage uploads. Bypasses Vercel's 4.5 MB function
// body limit (which is platform-level, not configurable, applies to all
// plans). The server issues a short-lived signed-upload URL via the
// service-role client; the browser PUTs the bytes directly to Supabase;
// then the browser tells the server "the file is at <path>" so it can
// register the metadata row.
//
// We hand-roll the PUT via XMLHttpRequest instead of using the Supabase
// SDK's uploadToSignedUrl (which uses fetch internally). Reason: iOS
// Safari + fetch + multi-MB PUT body + cellular network is a known
// failure mode where fetch resolves "ok" prematurely without actually
// transmitting the bytes — leaving an empty path the server has to
// reject. XHR's network stack is older and more reliable for large
// PUTs on iOS; bonus, it gives us real upload-progress events.

import { publicEnv } from "./env";

export interface SignedUpload {
  bucket: string;
  path: string;
  token: string;
}

/**
 * Upload a file using a signed upload URL previously issued by the server.
 * Throws on failure; resolves to nothing on success. After this resolves,
 * call the server's "register" endpoint to commit the metadata.
 *
 * Note: optional onProgress is called with (bytesUploaded, totalBytes)
 * during the PUT. We don't currently surface this in the UI but the hook
 * is here for when we want to.
 */
export async function uploadToSignedUrl(
  signed: SignedUpload,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const url =
    `${base}/storage/v1/object/upload/sign/${signed.bucket}/${signed.path}` +
    `?token=${encodeURIComponent(signed.token)}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(
            `PUT ${xhr.status}: ${(xhr.responseText || xhr.statusText || "").slice(0, 200)}`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("PUT network error"));
    xhr.ontimeout = () => reject(new Error("PUT timeout"));
    xhr.send(file);
  });
}

/**
 * Upload with automatic retry. iOS Safari + TG WebView produces generic
 * "Load failed" errors on transient network blips; one retry covers most.
 *
 * IMPORTANT: the signed URL is generated ONCE and reused across retries
 * (not regenerated per attempt). Reason: iOS has been seen to report PUT
 * failure on a connection drop AFTER the server already received the
 * bytes. If we retry with a fresh URL we end up with TWO uploads — one
 * orphan in storage and one ghost row in the DB pointing nowhere. With
 * the same URL, a successful-then-spurious-failure retry will either
 * succeed cleanly (Supabase reuses the existing object) or fail with
 * token-already-used (in which case the original upload IS there at
 * the path we already know about).
 */
export async function uploadWithRetry(
  getSignedUrl: () => Promise<SignedUpload>,
  file: File,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<SignedUpload> {
  const attempts = options.attempts ?? 2;
  const backoff = options.backoffMs ?? 1000;
  const signed = await getSignedUrl();
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await uploadToSignedUrl(signed, file);
      return signed;
    } catch (e) {
      lastError = e;
      console.warn(`upload-to-storage attempt ${i + 1}/${attempts} failed`, e);
      if (i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`upload failed after ${attempts} attempts`);
}
