// Workaround for a case we hit in prod where `supabase.storage.from(bucket)
// .createSignedUrl(path)` returns "Object not found" for an object that
// demonstrably exists in `storage.objects` with the matching bucket_id +
// name. Bypasses the SDK wrapper and hits Supabase's storage REST endpoint
// directly with the service-role key.
//
// If the raw call ALSO returns "Object not found" then the bug is server-side
// in Supabase Storage (likely a metadata-shape mismatch between rows created
// via signed-upload-URL and the row shape the sign endpoint expects). In
// that case we fall back to the SDK's error so the caller can surface it.

import { publicEnv, serverEnv } from "./env";

export interface SignResult {
  signedUrl: string | null;
  status: number;
  bodyText: string;
}

/**
 * POST to `/storage/v1/object/sign/{bucket}/{path}` with the service-role
 * key, mirroring what the JS SDK's `createSignedUrl` does internally.
 * Returns the absolute signed URL on success, or the raw error so the
 * caller can log/return it.
 */
export async function signStorageUrlRaw(
  bucket: string,
  path: string,
  expiresIn = 900,
): Promise<SignResult> {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const url = `${base}/storage/v1/object/sign/${bucket}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${serverEnv.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    return { signedUrl: null, status: res.status, bodyText };
  }
  let parsed: { signedURL?: string } = {};
  try {
    parsed = JSON.parse(bodyText) as { signedURL?: string };
  } catch {
    return { signedUrl: null, status: res.status, bodyText };
  }
  if (!parsed.signedURL) {
    return { signedUrl: null, status: res.status, bodyText };
  }
  // Supabase returns the path part starting with `/object/sign/...`. Prepend
  // the project URL to get an absolute URL the browser can load.
  return {
    signedUrl: `${base}${parsed.signedURL}`,
    status: res.status,
    bodyText,
  };
}
