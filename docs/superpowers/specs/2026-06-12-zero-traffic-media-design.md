# Zero-traffic media (all inbound types) — design

> Status: ACTIVE. Supersedes `2026-06-11-voice-client-blob-design.md` (which
> explored a client-blob path that was disproven by TG's `acao=null`).

**Goal:** Serve every inbound student media message (voice, video_note, and
any future kind) without its bytes passing through Vercel — by storing each
file once in Supabase Storage and pointing the client straight at Supabase's
CDN, exactly the way admin library media already works.

**One-line architecture:** A `store-media` cron downloads each unstored media
message from Telegram once (via the permanent `file_id`), uploads it to a
public Supabase bucket, and stamps `storage_path` on the row; the Mini App
then loads `<audio>`/`<video>` directly from Supabase. The proxy at
`/api/media/[messageId]` stays as a fallback for the brief window before a
message is stored.

---

## Decisions (locked with the user)

1. **Public bucket, exactly like `media-library`.** No signing, no expiry —
   `getPublicUrl` + UUID-randomized paths. Making student media private is an
   explicit *later* step (see Out of scope), done once the zero-traffic path
   is proven. (Supabase's `createSignedUrl` is also still broken here — see
   migration `20260521000001` — so public is the proven mechanism today.)
2. **Supabase now.** Same backend as the library → genuinely uniform. All
   bucket I/O goes through one `src/server/media-storage.ts` seam so a future
   swap to R2 (zero egress, the documented scale-up) is a one-file change.
3. **Migrate existing media.** The `store-media` cron's first runs process the
   backlog of already-received messages; no separate script. It is idempotent
   (`storage_path IS NULL` guard) and batched.

---

## Current state (what we're changing)

- **Library media (outbound, admin):** already stored in the public
  `media-library` bucket, served via `mediaPublicUrl(storage_path)` —
  direct Supabase URL in the element `src`, zero Vercel bytes. This is the
  pattern we're extending. (`src/components/MediaPreview.tsx:45`,
  `src/server/handlers/media-relay.ts:7,72`.)
- **Inbound student media (the holdout):** stored only as a Telegram
  `file_id`. `GET /api/media/[messageId]` byte-proxies voice through Vercel
  and 302-redirects video_note to Telegram's CDN (expiring `file_path`, bot
  token in URL). (`src/app/api/media/[messageId]/route.ts:46-107`.)
- Telegram `file_id` is **permanent** (re-`getFile` any time); only the
  derived `file_path` expires (~1h). So we can fetch any historical message's
  bytes on demand — backfill is always possible.
- The CAF remuxer (`src/lib/ogg-to-caf.ts`, `oggOpusToCaf`) and the client
  codec pick (`isOggOpusSupported`, `src/lib/audio-support.ts`) already exist.

---

## Architecture

### 1. Storage: new public bucket `student-media`

A **separate** public bucket from `media-library`. Rationale: keeps the
future "make student PII private" step a clean one-bucket flip, and keeps
admin teaching content and student recordings organizationally distinct.
Mechanism is identical to `media-library` (public, `getPublicUrl`,
`crypto.randomUUID()` paths for enumeration protection).

Created public directly (no private→public dance):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-media', 'student-media', true,
  52428800, -- 50 MB, TG bot-API file ceiling
  array[
    'audio/ogg','audio/x-caf',
    'video/mp4','video/quicktime',
    'image/jpeg','image/png','image/webp'
  ]
)
on conflict (id) do nothing;
```

### 2. Schema: storage columns on `messages`

```sql
alter table public.messages add column storage_path     text;
alter table public.messages add column storage_caf_path text; -- voice only
alter table public.messages add column stored_at        timestamptz;
```

- `storage_path` — path of the original in `student-media` (`.ogg`/`.mp4`/…).
  NULL = not yet stored (drives the cron's work-queue + the client fallback).
- `storage_caf_path` — for voice only, the lossless CAF remux for pre-18.4
  WebKit; NULL for every other kind.
- `stored_at` — observability marker (when the cron stored it).

### 3. Ingestion: the `store-media` cron

`src/app/api/cron/store-media/route.ts` (Bearer `CRON_SECRET`, GET+POST,
`maxDuration = 60`, registered in `sync-qstash.mjs` at `*/1 * * * *`):

1. Select up to **25** messages where `file_id IS NOT NULL` and
   `storage_path IS NULL` and `media_library_id IS NULL` (oldest first →
   backlog drains deterministically). The `media_library_id IS NULL` clause
   excludes outbound library sends — their rows *do* carry a `file_id`
   (`media-relay.ts:129`), but those bytes already live in the public
   `media-library` bucket and render via `media_library.storage_path`, so
   re-storing them would be pure duplication.
2. For each, call `storeMessageMedia(message)`:
   - `getFile(file_id)` → fetch bytes from Telegram.
   - Upload original to `student-media` at `${student_id}/${randomUUID}.${ext}`
     with the correct content-type (`audio/ogg`, `video/mp4`, …) via the
     storage seam.
   - **Voice only:** `oggOpusToCaf(bytes)` → upload `${same}.caf`
     (`audio/x-caf`).
   - `UPDATE messages SET storage_path=…, storage_caf_path=…, stored_at=now()
     WHERE id=… AND storage_path IS NULL` (guard = idempotent + race-safe).
3. Per-message failures are caught and logged (`console.warn`) — one bad file
   never blocks the batch; it's simply retried next tick.
4. Returns `{ scanned, stored, failed }`.

The **first few runs after deploy are the one-time migration** of existing
messages; steady-state stores each new message within ~60s. No webhook
hot-path changes (no added latency/failure to message receipt).

> Note: applies to **both** directions — the Mini App (teacher+admin) renders
> inbound student voices *and* relayed outbound tutor voice/video_note
> replies (`teacher-reply.ts:260`), so any non-library `messages` row with a
> `file_id` is in scope. Outbound *library* sends are excluded by the
> `media_library_id IS NULL` clause above (they serve from the library bucket).

### 4. Serving: thread API + client

- **Thread API** (`src/app/api/threads/[studentId]/route.ts`): add
  `storage_path`, `storage_caf_path` to the message select + response shape.
- **Client** (`src/components/MessageBubble.tsx`): a `studentMediaUrl(path)`
  helper (parallel to `mediaPublicUrl`, pointed at `student-media`) builds the
  direct Supabase URL.
  - **Voice:** if `storage_path` present →
    `studentMediaUrl(isOggOpusSupported() ? storage_path : storage_caf_path)`
    in the `<audio src>`. Else → existing `voiceProxyUrl()` fallback.
  - **video_note:** if `storage_path` present → `studentMediaUrl(storage_path)`
    in `<video src>`. Else → existing `/api/media/[id]` (302) fallback.
  - We use the **direct URL in `src`** (never a 302 to it) deliberately:
    `MediaPreview.tsx:36-44` documents that iOS WebKit silently fails on
    media-element + 302 + cross-origin range. Direct URL is the proven path.

### 5. Storage seam

`src/server/media-storage.ts`:

```ts
export const STUDENT_MEDIA_BUCKET = "student-media";
export async function uploadStudentMedia(path, bytes, contentType): Promise<void>
export function studentMediaPublicPath(path): string  // bucket-relative → full public URL
```

All bucket writes (cron) and the public-URL construction route through here.
Swapping to R2 later = reimplement this file only.

### 6. Codec handling (why voice plays everywhere with zero traffic)

Supabase serves objects with the **content-type they were uploaded with**, so
the octet-stream-no-sniff problem that forced the proxy disappears:

| Kind | Stored | Content-type | Plays on |
|------|--------|--------------|----------|
| video_note | `.mp4` | `video/mp4` | everywhere (sniffed + universal codec) |
| voice (modern) | `.ogg` | `audio/ogg` | Chrome/FF/Android, iOS 18.4+/macOS 15.4+ |
| voice (old WebKit) | `.caf` | `audio/x-caf` | iOS 11+/macOS — selected by `isOggOpusSupported()` |

No transcoding, no ffmpeg — we reuse the exact remuxer + client pick already
in the tree.

---

## Files

```
supabase/migrations/<ts>_student_media_bucket_and_columns.sql  # bucket + 3 messages columns
src/types/database.ts                                          # storage_path/_caf_path/stored_at on Message
src/server/media-storage.ts                                    # NEW seam: bucket consts + upload + url
src/server/store-media.ts                                      # NEW: storeMessageMedia(message) core (unit-testable)
src/app/api/cron/store-media/route.ts                          # NEW: batched, idempotent cron
scripts/sync-qstash.mjs                                        # add { path:"/api/cron/store-media", cron:"*/1 * * * *" }
src/app/api/threads/[studentId]/route.ts                       # select + return storage_path/_caf_path
src/components/MessageBubble.tsx                               # studentMediaUrl + prefer stored URL, proxy fallback
src/components/MediaPreview.tsx                                # (optional) generalize mediaPublicUrl(bucket, path)
tests/store-media.test.ts                                      # NEW: ext/content-type mapping + work-queue selection logic
```

`/api/media/[messageId]/route.ts` is **unchanged** — it remains the fallback.

---

## End-to-end verification

1. **Backlog migration:** after deploy, hit the cron a few times
   (`curl -X POST .../api/cron/store-media -H "Authorization: Bearer $CRON_SECRET"`)
   → `stored` count climbs, then `scanned>0, stored=0` once drained. DB rows
   have `storage_path` (+ `storage_caf_path` for voice) and `stored_at`.
2. **Voice playback (zero traffic):** open a thread with a stored voice on
   iPhone + Mac → it plays; DevTools/network shows the bytes coming from
   `*.supabase.co`, not `/api/media`. Pre-18.4 device pulls the `.caf`.
3. **video_note:** plays from the Supabase URL, not the 302.
4. **New message:** send a fresh voice → within ~60s `storage_path` is set;
   before that the bubble still plays via the proxy fallback (no broken
   state), after that via Supabase.
5. **Idempotency:** re-run the cron → already-stored rows untouched
   (`stored=0`), no duplicate objects.
6. **Fallback intact:** temporarily null a row's `storage_path` → bubble
   still plays via `/api/media/[id]`.

---

## Out of scope (named, not built)

- **Privacy hardening** — flip `student-media` to a private bucket + signed
  URLs (or our-endpoint-302-to-signed) once the zero-traffic path is proven.
  Requires Supabase signing to work; revisit then. (This is the deferred
  decision the Monday 2026-06-15 cloud reminder covers — it can be closed.)
- **Cloudflare R2** — the genuine zero-egress backend; swap behind the
  storage seam when Supabase's 5 GB/mo egress becomes the binding constraint.
- **Retention/TTL** — media is kept indefinitely for now (PoC volume is tiny).
- **Deleting the legacy proxy** — keep `/api/media/[messageId]` as the
  fallback; remove only after stored coverage is ~100% and observed.
```