// Direct existence check against storage.objects. We bypass the SDK's
// list() (which has prefix-match quirks that can false-positive) and the
// SDK's createSignedUrl (which has been seen to return "Object not found"
// for rows that clearly exist). PostgREST direct table read with service
// role is the most reliable probe.

import { publicEnv, serverEnv } from "./env";

/**
 * Polls storage.objects with short backoff. The PUT can succeed at the S3
 * layer milliseconds before the storage.objects row is indexed; without
 * the polling loop a fast registration POST may false-negative.
 */
export async function storageObjectExists(
  bucket: string,
  path: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 500;
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const url =
    `${base}/rest/v1/objects?select=id` +
    `&bucket_id=eq.${encodeURIComponent(bucket)}` +
    `&name=eq.${encodeURIComponent(path)}` +
    `&limit=1`;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${serverEnv.SUPABASE_SERVICE_ROLE_KEY}`,
        "Accept-Profile": "storage",
      },
    });
    if (res.ok) {
      const rows = (await res.json()) as { id: string }[];
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}
