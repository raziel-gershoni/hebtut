import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";

// Presigned GET URLs are re-minted on every thread load, so a moderate TTL is
// fine — 6h comfortably covers a viewing session without leaving long-lived
// links to student-voice PII lying around.
const SIGNED_URL_TTL_SECONDS = 6 * 3600;

let cached: { client: S3Client; bucket: string } | null = null;

/**
 * Storage seam — Cloudflare R2 (S3-compatible), PRIVATE bucket + presigned
 * URLs: zero egress, and student media is never publicly addressable. Swapping
 * providers (back to Supabase, or to plain S3) is contained to this file.
 *
 * Throws if the R2 env is unset so callers degrade to the /api/media proxy
 * fallback rather than silently mis-serving. Client is memoised across warm
 * invocations.
 */
function r2(): { client: S3Client; bucket: string } {
  if (cached) return cached;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = serverEnv;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error("R2 storage env not configured");
  }
  cached = {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    }),
    bucket: R2_BUCKET,
  };
  return cached;
}

/** Upload bytes to the private student-media bucket (idempotent overwrite). */
export async function uploadStudentMedia(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = r2();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: path, Body: bytes, ContentType: contentType }),
  );
}

/** Short-lived presigned GET URL — the client plays directly from R2, no proxy. */
export async function signedStudentMediaUrl(path: string): Promise<string> {
  const { client, bucket } = r2();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), {
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}
