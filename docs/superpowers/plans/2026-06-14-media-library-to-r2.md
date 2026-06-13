# Media-library → Cloudflare R2 migration plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.
> Steps use checkbox (`- [ ]`). This is a PLAN for approval — do not execute
> until the user signs off.

**Goal:** Move the admin/teacher **media-library** (the `media-library` Supabase
PUBLIC bucket — reusable photos/videos/audio) onto Cloudflare R2 (private bucket
+ presigned URLs), the same backend + posture the student media already uses, so
all media is zero-egress and nothing is public.

**Architecture:** Mirror the proven student-media cutover — add a
`media_library.r2_migrated` flag, copy existing objects Supabase→R2 with a job,
send NEW uploads straight to R2 (presigned PUT), and serve via server-minted
presigned GET URLs with Supabase-public fallback for not-yet-copied rows. No
cron race here (library writes are admin-triggered, not cron), but the
flag-gated serving keeps the deploy ordering-safe.

**Spec reference:** extends `docs/superpowers/specs/2026-06-12-zero-traffic-media-design.md`.

---

## Decisions (recommended — confirm before executing)

1. **Private R2 + presigned URLs** (not public). Consistent with student-media,
   needs no custom domain. Library content is less sensitive than student PII,
   but private+presigned is the simpler path here (public R2 in prod requires a
   custom Cloudflare domain; presigned needs nothing).
2. **Separate R2 bucket `media-library`** (not the `student-media` bucket).
   Distinct lifecycle/retention, clean isolation, trivial extra cost.
3. **Flag-gated cutover** via `media_library.r2_migrated` + a copy job. Serving
   presigns R2 when migrated, else falls back to the existing Supabase public
   URL — so deploy order doesn't matter and there's no broken window.
4. **New uploads go straight to R2** (browser PUTs to a presigned URL), dropping
   the TUS/`upload-proxy` hop for library. Row inserted with `r2_migrated=true`.
5. **Onboarding videos are OUT of scope** (a separate Supabase-public surface;
   can follow this exact pattern later).
6. **Copy source = Supabase storage** (not TG `tg_file_id`, which is null until
   an item's first send). One-time download-through-Vercel per item; the library
   is small.

---

## Approach

### Generalise the storage seam (currently single-bucket)

`src/server/media-storage.ts` is hardwired to one bucket (`R2_BUCKET`). Split the
client from the bucket so both buckets share one R2 client:

```ts
// new env (Vercel): R2_MEDIA_LIBRARY_BUCKET=media-library
function r2Client(): S3Client            // builds/caches the client (throws R2NotConfiguredError)
export async function uploadToR2(bucket, path, bytes, contentType): Promise<void>
export async function signedR2GetUrl(bucket, path, ttl?): Promise<string>
export async function signedR2PutUrl(bucket, path, contentType, ttl?): Promise<string>  // for direct browser upload
export const STUDENT_MEDIA_BUCKET = serverEnv.R2_BUCKET
export const MEDIA_LIBRARY_BUCKET = serverEnv.R2_MEDIA_LIBRARY_BUCKET
// keep uploadStudentMedia / signedStudentMediaUrl as thin wrappers (no caller churn)
```

### Serving surfaces to switch (Supabase-public → presigned-R2-or-fallback)

Each must serve a presigned R2 URL when `r2_migrated`, else the current Supabase
public URL:

| Surface | File | Today | After |
|---|---|---|---|
| Admin media list | `src/app/api/admin/media/route.ts` (GET) | returns `storage_path`; client builds `mediaPublicUrl` | return a per-item `url` (presigned R2 or Supabase public) |
| Picker/preview tiles | `src/components/MediaPreview.tsx` | `mediaPublicUrl` / `previewUrl` | use the server-provided `url` |
| Photo/video preview endpoint | `src/app/api/admin/media/[id]/preview/route.ts` | 302 / json to Supabase public | 302 / json to presigned R2 when migrated |
| Chat library bubble | thread API embed + `MessageBubble` `LibraryMediaBlock` | `media_library.storage_path` → `mediaPublicUrl` | thread API presigns → `media_library.url` |
| TG send (first send) | `src/server/handlers/media-relay.ts` | `getPublicUrl` → `InputFile(url)` | presigned R2 → `InputFile(url)` (TG fetches within TTL) |

### Upload flow (new uploads → R2)

- `POST /api/admin/media/upload-url` returns a **presigned R2 PUT URL** (+ path)
  instead of `{bucket, path}` for TUS.
- The uploader component PUTs the file directly to that URL (single PUT; ≤50 MB,
  no resumable needed), then `POST /api/admin/media` records the row with
  `r2_migrated=true`.
- `/api/admin/upload-proxy` (TUS→Supabase) is no longer used by library uploads
  — leave it if onboarding still uses it; otherwise remove in cleanup.

### Copy job (existing objects)

`src/app/api/cron/migrate-library-r2/route.ts` (or a guarded admin endpoint),
batched + idempotent, Bearer `CRON_SECRET`:
1. select `media_library` rows where `r2_migrated = false`, limit 25.
2. per row: `sb.storage.from('media-library').download(storage_path)` → bytes →
   `uploadToR2(MEDIA_LIBRARY_BUCKET, storage_path, bytes, mime_type)` →
   `update … set r2_migrated = true`.
3. log to `system_logs` (`source='migrate-library-r2'`), fail-soft per row.
Runs a few times to drain, then idle. (Can be a one-shot endpoint rather than a
standing cron, since there's no steady stream — new uploads already land in R2.)

---

## Files

```
supabase/migrations/<ts>_media_library_r2.sql        # add media_library.r2_migrated boolean default false
src/types/database.ts                                # media_library row: r2_migrated
src/server/media-storage.ts                          # generalise: r2Client + bucket-param upload/get/put helpers
src/lib/env.ts                                       # R2_MEDIA_LIBRARY_BUCKET (optional)
src/app/api/admin/media/upload-url/route.ts          # return presigned R2 PUT url
src/app/api/admin/media/route.ts                     # GET returns per-item presigned url + insert r2_migrated=true
src/app/api/admin/media/[id]/preview/route.ts        # presigned R2 (302/json) when migrated, else Supabase
src/app/api/threads/[studentId]/route.ts             # presign media_library.storage_path → media_library.url
src/server/handlers/media-relay.ts                   # presigned R2 url for the TG InputFile send
src/components/MediaPreview.tsx                       # consume server url; drop client mediaPublicUrl builder
src/components/MessageBubble.tsx                      # LibraryMediaBlock uses media_library.url
src/components/<media uploader>.tsx                  # PUT to presigned R2 url instead of TUS
src/app/api/cron/migrate-library-r2/route.ts         # NEW copy job (Supabase→R2)
scripts/sync-qstash.mjs                              # (only if run as a standing cron)
tests/media-storage.test.ts                          # pure bits: bucket selection / url shape
```

---

## Tasks (high level — expand to bite-sized on approval)

1. **Seam + env + types** — generalise `media-storage.ts`, add `R2_MEDIA_LIBRARY_BUCKET`, migration + type for `media_library.r2_migrated`. Verify tsc.
2. **Copy job** — `migrate-library-r2` endpoint (download Supabase → `uploadToR2`), idempotent on `r2_migrated`, system-logged. Verify locally (pure helpers) + by curl after deploy.
3. **Serving switch (read)** — admin list API, `/preview`, thread-API library embed, `MediaPreview`, `LibraryMediaBlock`: presigned-R2-when-migrated else Supabase-public fallback. tsc + manual.
4. **TG send** — `media-relay` uses a presigned R2 URL for `InputFile`. Verify a fresh library send to a student still ingests + caches `tg_file_id`.
5. **Upload flow** — `upload-url` returns presigned PUT; uploader PUTs to R2; row `r2_migrated=true`. Verify a new upload lands in R2 + plays.
6. **Migrate + verify + cleanup** — deploy, run the copy job to drain, confirm previews/sends/uploads all serve from R2 (network tab + `media-read`/library logs), then delete the Supabase `media-library` bucket.

---

## End-to-end verification

1. Copy job drains: repeated curl → `migrated` climbs then 0; rows have `r2_migrated=true`.
2. Admin media manager: thumbnails/previews load from `*.r2.cloudflarestorage.com` (presigned), not Supabase.
3. New upload: file PUTs to R2, row `r2_migrated=true`, preview plays.
4. Send a library item to a student: first send ingests to TG (InputFile from presigned URL) and caches `tg_file_id`; subsequent sends reuse it.
5. Chat library bubble (teacher view) plays from R2.
6. Un-migrated row (flip `r2_migrated=false` on one) still serves via Supabase fallback — no breakage.
7. After full migration: delete Supabase `media-library` bucket; nothing 404s.

---

## Out of scope (named)

- **Onboarding videos** (`onboarding_videos`, also Supabase public) — same pattern, separate pass.
- **Public R2 + custom domain** — not pursued; presigned is enough.
- **Resumable/multipart upload** — single PUT is fine ≤50 MB; revisit only if larger files are allowed.
- **Removing `/api/admin/upload-proxy`** — only after confirming onboarding (or anything else) no longer needs the Supabase TUS path.
