"use client";

// Direct-to-Supabase-Storage uploads via the TUS resumable protocol.
//
// Why TUS: Supabase officially recommends it for files >6 MB. The previous
// signed-upload-URL pattern (single PUT) was fragile on iOS WebKit +
// cellular — fetch could resolve "ok" without actually transmitting the
// bytes, leaving ghost storage.objects rows. TUS chunks the upload (4 MB
// each, kept under Vercel's 4.5 MB function body limit) and explicitly
// confirms each chunk's offset, so there's no false-success failure mode.
// On a network blip TUS resumes from the last confirmed chunk instead of
// restarting from zero.
//
// The browser never talks to Supabase directly — it goes through our
// /api/admin/upload-proxy route, which validates admin via OUR JWT and
// then forwards each chunk to Supabase with the service-role key. That
// avoids needing any Supabase auth on the client.

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
 */
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
