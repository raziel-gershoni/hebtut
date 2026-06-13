import { publicEnv } from "@/lib/env";

/**
 * Storage-backend seam (URL side). Swapping Supabase → R2 later changes only
 * this file + media-storage.ts. Pure + client-safe (no server-only imports),
 * so both the cron and the Mini App bundle can import it.
 */
export const STUDENT_MEDIA_BUCKET = "student-media";

/** Direct public-CDN URL for an object. The bucket is public, so this just
 * builds the string — no lookup, no auth, no Vercel bytes. */
export function storagePublicUrl(bucket: string, path: string): string {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
