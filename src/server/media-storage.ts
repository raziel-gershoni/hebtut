import { getServiceRoleClient } from "@/lib/supabase-server";
import { STUDENT_MEDIA_BUCKET } from "@/lib/storage-url";

/**
 * Storage-backend seam (write side). Uploads to the public student-media
 * bucket via the service role (bypasses RLS). `upsert: true` keeps a retried
 * store idempotent at the object level even if the row update lost a race.
 */
export async function uploadStudentMedia(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { error } = await sb.storage
    .from(STUDENT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`student-media upload failed: ${error.message}`);
}
