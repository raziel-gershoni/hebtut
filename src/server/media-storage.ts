import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";

// Presigned GET URLs are re-minted on every thread load, so a moderate TTL is
// fine — 6h comfortably covers a viewing session without leaving long-lived
// links to student-voice PII lying around.
const SIGNED_URL_TTL_SECONDS = 6 * 3600;

// Presigned PUT URLs are minted right before the browser uploads, so a short
// TTL is plenty — 10 min covers picking + (client-side) compressing + the
// single PUT without leaving a writable link around longer than needed.
const PUT_URL_TTL_SECONDS = 10 * 60;

/** Thrown when the R2 env isn't fully set. Typed (not a string match) so the
 * store-media cron can recognise it and skip without burning the retry cap. */
export class R2NotConfiguredError extends Error {}

let cachedClient: S3Client | null = null;

/**
 * Storage seam — Cloudflare R2 (S3-compatible), PRIVATE buckets + presigned
 * URLs: zero egress, and media is never publicly addressable. Swapping
 * providers (back to Supabase, or to plain S3) is contained to this file.
 *
 * The S3 client is shared across buckets (student-media + media-library) — only
 * the credentials/endpoint are per-account, the bucket is a per-call param.
 * Throws if the R2 env is unset so callers degrade to the /api/media proxy
 * fallback rather than silently mis-serving. Client is memoised across warm
 * invocations.
 */
function r2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = serverEnv;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new R2NotConfiguredError("R2 storage env not configured");
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    // aws-sdk-js v3 defaults to WHEN_SUPPORTED, which bakes an
    // x-amz-checksum-crc32 (computed over an EMPTY body at presign time) into a
    // presigned PUT URL — the browser then PUTs the real file and R2 rejects it
    // on checksum mismatch. WHEN_REQUIRED disables that; PutObject doesn't
    // require a checksum, and server-side uploads (real bytes) are unaffected.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return cachedClient;
}

/** Upload bytes to a private R2 bucket (idempotent overwrite). Throws
 * R2NotConfiguredError when the bucket isn't configured. */
export async function uploadToR2(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!bucket) throw new R2NotConfiguredError("R2 bucket not configured");
  await r2Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: path, Body: bytes, ContentType: contentType }),
  );
}

/** Short-lived presigned GET URL — the client plays directly from R2, no proxy.
 * Throws R2NotConfiguredError when the bucket isn't configured. */
export async function signedR2GetUrl(
  bucket: string,
  path: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  if (!bucket) throw new R2NotConfiguredError("R2 bucket not configured");
  return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: bucket, Key: path }), {
    expiresIn: ttlSeconds,
  });
}

/** Upload bytes to the private student-media bucket (idempotent overwrite). */
export async function uploadStudentMedia(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  return uploadToR2(serverEnv.R2_BUCKET ?? "", path, bytes, contentType);
}

/** Short-lived presigned GET URL for student media — direct R2, no proxy. */
export async function signedStudentMediaUrl(path: string): Promise<string> {
  return signedR2GetUrl(serverEnv.R2_BUCKET ?? "", path);
}

/**
 * Short-lived presigned PUT URL — the browser uploads bytes straight to R2
 * with no server proxy hop. Signing WITH `contentType` means the PUT MUST
 * carry a matching `Content-Type` header (intended: it also makes R2 store the
 * right content-type so presigned GETs serve playable media). Throws
 * R2NotConfiguredError when the bucket isn't configured.
 */
export async function signedR2PutUrl(
  bucket: string,
  path: string,
  contentType: string,
  ttlSeconds = PUT_URL_TTL_SECONDS,
): Promise<string> {
  if (!bucket) throw new R2NotConfiguredError("R2 bucket not configured");
  return getSignedUrl(
    r2Client(),
    new PutObjectCommand({ Bucket: bucket, Key: path, ContentType: contentType }),
    { expiresIn: ttlSeconds },
  );
}

/** Short-lived presigned PUT URL for media-library objects — direct R2, no proxy. */
export async function signedLibraryPutUrl(path: string, contentType: string): Promise<string> {
  return signedR2PutUrl(serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "", path, contentType);
}

/** Upload bytes to the private media-library bucket (idempotent overwrite). */
export async function uploadLibraryMedia(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  return uploadToR2(serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "", path, bytes, contentType);
}

/** Short-lived presigned GET URL for media-library objects — direct R2, no proxy. */
export async function signedLibraryMediaUrl(path: string): Promise<string> {
  return signedR2GetUrl(serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "", path);
}

/** Delete an object from a private R2 bucket. Throws R2NotConfiguredError when
 * the bucket isn't configured. */
export async function deleteFromR2(bucket: string, path: string): Promise<void> {
  if (!bucket) throw new R2NotConfiguredError("R2 bucket not configured");
  await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
}

/** Delete a media-library object from R2 (called when a library item is removed). */
export async function deleteLibraryMedia(path: string): Promise<void> {
  return deleteFromR2(serverEnv.R2_MEDIA_LIBRARY_BUCKET ?? "", path);
}

/** List every object in a bucket (paginated). Read-only — used by the orphan
 * audit. Throws R2NotConfiguredError when the bucket isn't configured. */
export async function listAllR2Objects(
  bucket: string,
): Promise<{ key: string; size: number }[]> {
  if (!bucket) throw new R2NotConfiguredError("R2 bucket not configured");
  const client = r2Client();
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of resp.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}
