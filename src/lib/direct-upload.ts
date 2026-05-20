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
 * Upload with automatic retry. Each attempt requests a fresh signed URL
 * (via `getSignedUrl`) so a stale / consumed token doesn't poison the
 * retry. iOS Safari + Telegram WebView is the typical environment, and
 * its generic "Load failed" fetch error covers everything from CORS
 * preflight quirks to a momentarily-dropped 5G connection — a single
 * retry resolves most of them.
 */
export async function uploadWithRetry(
  getSignedUrl: () => Promise<SignedUpload>,
  file: File,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<SignedUpload> {
  const attempts = options.attempts ?? 2;
  const backoff = options.backoffMs ?? 1000;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const signed = await getSignedUrl();
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
