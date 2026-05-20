"use client";

// Direct-to-Supabase-Storage uploads. Bypasses Vercel's 4.5 MB function
// body limit (which is platform-level, not configurable, applies to all
// plans). The server issues a short-lived signed-upload URL via the
// service-role client; the browser PUTs the bytes directly to Supabase;
// then the browser tells the server "the file is at <path>" so it can
// register the metadata row.
//
// This is the standard Supabase pattern for any upload that might exceed
// the function body limit.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "./env";

let cachedClient: SupabaseClient | null = null;

function getBrowserSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  return cachedClient;
}

export interface SignedUpload {
  bucket: string;
  path: string;
  token: string;
}

/**
 * Upload a file using a signed upload URL previously issued by the server.
 * Throws on failure; resolves to nothing on success. After this resolves,
 * call the server's "register" endpoint to commit the metadata.
 */
export async function uploadToSignedUrl(
  signed: SignedUpload,
  file: File,
): Promise<void> {
  const sb = getBrowserSupabase();
  const { error } = await sb.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type,
      upsert: false,
    });
  if (error) {
    throw new Error(error.message);
  }
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
