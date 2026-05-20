// Direct existence check against storage.objects. We bypass the SDK's
// list() (which has prefix-match quirks that can false-positive) and the
// SDK's createSignedUrl (which has been seen to return "Object not found"
// for rows that clearly exist). PostgREST direct table read with service
// role is the most reliable probe.

import { publicEnv, serverEnv } from "./env";

export async function storageObjectExists(
  bucket: string,
  path: string,
): Promise<boolean> {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  // PostgREST endpoint for the storage schema. ?select=id&bucket_id=eq.X
  // &name=eq.Y returns an array of matching rows.
  const url =
    `${base}/rest/v1/objects?select=id` +
    `&bucket_id=eq.${encodeURIComponent(bucket)}` +
    `&name=eq.${encodeURIComponent(path)}` +
    `&limit=1`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      apikey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${serverEnv.SUPABASE_SERVICE_ROLE_KEY}`,
      "Accept-Profile": "storage",
    },
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as { id: string }[];
  return Array.isArray(rows) && rows.length > 0;
}
