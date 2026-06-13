# Zero-traffic store-once media — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development (or
> executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Serve inbound student media (voice + video_note + any future kind)
from Supabase's CDN instead of proxying bytes through Vercel — store each file
once, point the client straight at the public bucket.

**Architecture:** A `store-media` cron downloads each un-stored media message
from Telegram once (permanent `file_id`), uploads to a public `student-media`
bucket (voice also gets a CAF remux), and stamps `storage_path` on the row. The
client loads `<audio>`/`<video>` directly from Supabase; the existing
`/api/media/[id]` proxy stays as the fallback for not-yet-stored rows. Mirrors
the already-working library-media pattern (public bucket + `getPublicUrl`).

**Tech stack:** Next.js (app router, node runtime), Supabase Storage + Postgres,
QStash cron, grammY (TG getFile), existing `oggOpusToCaf` remuxer, vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-zero-traffic-media-design.md`

---

### Task 1: Migration — public bucket + storage columns

**Files:**
- Create: `supabase/migrations/20260613000001_student_media.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Inbound student media (voice / video_note / …) stored once in Supabase and
-- served straight from the CDN, zero Vercel egress. Public bucket mirrors
-- media-library (signed URLs are still broken here — see 20260521000001); UUID
-- paths give enumeration protection. Privacy hardening (private + signed) is a
-- deliberate follow-up once the zero-traffic path is proven.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-media', 'student-media', true,
  52428800, -- 50 MB, TG bot-API file ceiling
  array[
    'audio/ogg','audio/x-caf',
    'video/mp4','video/quicktime',
    'image/jpeg','image/png','image/webp',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- storage_path NULL = not yet stored (drives the cron work-queue AND the
-- client's proxy fallback). storage_caf_path: voice-only CAF remux for
-- pre-18.4 WebKit. stored_at: observability marker.
alter table public.messages add column if not exists storage_path     text;
alter table public.messages add column if not exists storage_caf_path text;
alter table public.messages add column if not exists stored_at        timestamptz;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260613000001_student_media.sql
git commit -m "feat(media): student-media public bucket + messages storage columns"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `src/types/database.ts` (messages Row ~line 139, Insert ~line 162)

- [ ] **Step 1: Add to messages `Row`** (after `translation_tg_message_id: number | null;`, before `created_at: string;`):

```ts
          storage_path: string | null;
          storage_caf_path: string | null;
          stored_at: string | null;
```

- [ ] **Step 2: Add to messages `Insert`** (after `translation_tg_message_id?: number | null;`, before `created_at?: string;`):

```ts
          storage_path?: string | null;
          storage_caf_path?: string | null;
          stored_at?: string | null;
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit   # expect: clean
git add src/types/database.ts
git commit -m "feat(media): storage columns on messages type"
```

---

### Task 3: Public-URL builder (client-safe seam)

**Files:**
- Create: `src/lib/storage-url.ts`

- [ ] **Step 1: Write it**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/storage-url.ts
git commit -m "feat(media): storage public-url seam"
```

---

### Task 4: Upload seam (server)

**Files:**
- Create: `src/server/media-storage.ts`

- [ ] **Step 1: Write it**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/server/media-storage.ts
git commit -m "feat(media): student-media upload seam"
```

---

### Task 5: Store core + pure helpers (TDD)

**Files:**
- Create: `src/server/store-media.ts`
- Create: `tests/store-media.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extFromTgFilePath, contentTypeForExt } from "@/server/store-media";

describe("extFromTgFilePath", () => {
  it("pulls the extension from a TG file_path", () => {
    expect(extFromTgFilePath("voice/file_12.oga")).toBe("oga");
    expect(extFromTgFilePath("video_notes/file_3.mp4")).toBe("mp4");
    expect(extFromTgFilePath("photos/file_9.JPG")).toBe("jpg");
  });
  it("falls back to bin when there is no extension", () => {
    expect(extFromTgFilePath("documents/file_1")).toBe("bin");
    expect(extFromTgFilePath("")).toBe("bin");
  });
});

describe("contentTypeForExt", () => {
  it("maps TG media extensions to playable content-types", () => {
    expect(contentTypeForExt("oga")).toBe("audio/ogg");
    expect(contentTypeForExt("ogg")).toBe("audio/ogg");
    expect(contentTypeForExt("opus")).toBe("audio/ogg");
    expect(contentTypeForExt("mp4")).toBe("video/mp4");
    expect(contentTypeForExt("mov")).toBe("video/quicktime");
    expect(contentTypeForExt("jpg")).toBe("image/jpeg");
    expect(contentTypeForExt("png")).toBe("image/png");
    expect(contentTypeForExt("webp")).toBe("image/webp");
  });
  it("defaults unknown extensions to octet-stream", () => {
    expect(contentTypeForExt("xyz")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`not a function`)

```bash
npx vitest run tests/store-media.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { STUDENT_MEDIA_BUCKET } from "@/lib/storage-url";
import { uploadStudentMedia } from "@/server/media-storage";
import { oggOpusToCaf, OggCafError } from "@/lib/ogg-to-caf";

/** Lowercased extension of a TG file_path ("voice/file_1.oga" → "oga"). */
export function extFromTgFilePath(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "bin";
  return base.slice(dot + 1).toLowerCase();
}

const CONTENT_TYPE: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Supabase serves objects with the content-type they were uploaded with, so
 * setting this correctly is what fixes WebKit's "won't sniff octet-stream"
 * problem that forced the proxy. */
export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export interface StorableMessage {
  id: number;
  student_id: number;
  kind: string;
  file_id: string;
}

/**
 * Download a message's media from Telegram once and persist it in the public
 * bucket. Voice additionally gets a lossless CAF remux for pre-18.4 WebKit.
 * Stamps storage_path/_caf_path/stored_at under a `storage_path IS NULL` guard
 * (idempotent + race-safe). Throws on any failure so the cron can count + log.
 */
export async function storeMessageMedia(msg: StorableMessage): Promise<void> {
  const sb = getServiceRoleClient();
  const file = await getBot().api.getFile(msg.file_id);
  if (!file.file_path) throw new Error("no file_path from getFile");
  const tgUrl = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const upstream = await fetch(tgUrl);
  if (!upstream.ok) throw new Error(`tg fetch ${upstream.status}`);
  const bytes = new Uint8Array(await upstream.arrayBuffer());

  const ext = extFromTgFilePath(file.file_path);
  const base = `${msg.student_id}/${crypto.randomUUID()}`;
  const origPath = `${base}.${ext}`;
  await uploadStudentMedia(origPath, bytes, contentTypeForExt(ext));

  let cafPath: string | null = null;
  if (msg.kind === "voice") {
    try {
      const caf = oggOpusToCaf(bytes);
      cafPath = `${base}.caf`;
      await uploadStudentMedia(cafPath, caf, "audio/x-caf");
    } catch (e) {
      // Bad/unexpected Ogg shape: keep the original (modern WebKit + everyone
      // else still plays it); only pre-18.4 WebKit loses out. Don't fail the
      // whole store over the derivative.
      if (!(e instanceof OggCafError)) throw e;
      console.warn("[store-media] caf remux failed; ogg only", {
        message_id: msg.id,
        reason: e.message,
      });
      cafPath = null;
    }
  }

  const { error } = await sb
    .from("messages")
    .update({
      storage_path: origPath,
      storage_caf_path: cafPath,
      stored_at: new Date().toISOString(),
    })
    .eq("id", msg.id)
    .is("storage_path", null);
  if (error) throw new Error(`row update failed: ${error.message}`);
}

void STUDENT_MEDIA_BUCKET; // re-exported indirectly via media-storage; keep import meaningful
```

> Note: drop the trailing `void STUDENT_MEDIA_BUCKET;` line — it's only there to
> flag that the bucket constant is owned by storage-url.ts. Do not import it
> here if unused; remove the import instead.

- [ ] **Step 4: Run it — expect PASS**

```bash
npx vitest run tests/store-media.test.ts
```

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit && npx eslint src/server/store-media.ts
git add src/server/store-media.ts tests/store-media.test.ts
git commit -m "feat(media): store-media core + ext/content-type helpers (tested)"
```

---

### Task 6: The store-media cron

**Files:**
- Create: `src/app/api/cron/store-media/route.ts`

- [ ] **Step 1: Write it**

```ts
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { storeMessageMedia } from "@/server/store-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Downloads + remuxes up to BATCH files per run; 60 is the Pro ceiling.
export const maxDuration = 60;

const BATCH = 25;

async function handler(req: NextRequest): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  // Work-queue: un-stored, non-library media (library rows carry a file_id too
  // but already live in the media-library bucket). Oldest first so the backlog
  // — i.e. the one-time migration of existing messages — drains deterministically.
  const { data: rows, error } = await sb
    .from("messages")
    .select("id, student_id, kind, file_id")
    .not("file_id", "is", null)
    .is("storage_path", null)
    .is("media_library_id", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("[store-media] queue query failed", error.message);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }

  let stored = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    if (!r.file_id) continue;
    try {
      await storeMessageMedia({
        id: r.id,
        student_id: r.student_id,
        kind: r.kind,
        file_id: r.file_id,
      });
      stored++;
    } catch (e) {
      failed++;
      console.warn("[store-media] store failed", {
        message_id: r.id,
        reason: (e as Error).message,
      });
    }
  }
  return Response.json({ scanned: rows?.length ?? 0, stored, failed });
}

export { handler as GET, handler as POST };
```

- [ ] **Step 2: Verify + commit**

```bash
npx tsc --noEmit && npx eslint src/app/api/cron/store-media/route.ts
git add src/app/api/cron/store-media/route.ts
git commit -m "feat(media): store-media cron (batched, idempotent, fail-soft)"
```

---

### Task 7: Register the cron schedule

**Files:**
- Modify: `scripts/sync-qstash.mjs` (the `SCHEDULES` array)

- [ ] **Step 1: Add the entry** after the `onboarding` line, before `engagement`:

```js
  // Store-once media: downloads un-stored inbound voice/video_note from TG into
  // Supabase so the client serves them straight from the CDN (zero Vercel
  // egress). First runs after deploy drain the existing backlog; steady-state
  // stores new media within ~60s (proxy fallback covers the gap).
  { path: "/api/cron/store-media", cron: "*/1 * * * *" },
```

- [ ] **Step 2: Commit**

```bash
git add scripts/sync-qstash.mjs
git commit -m "feat(media): schedule the store-media cron"
```

---

### Task 8: Thread API returns storage paths

**Files:**
- Modify: `src/app/api/threads/[studentId]/route.ts` (select ~line 40; mapped row ~line 122-139)

- [ ] **Step 1: Add to the messages select string** (append the two columns):

```ts
      "id, direction, kind, duration, status, reply_to_id, created_at, teacher_id, text_content, media_library_id, transcript_text, transcript_tg_message_id, translation_text, translation_tg_message_id, storage_path, storage_caf_path",
```

- [ ] **Step 2: Add to the mapped message object** (in the `.map((m) => ({ … }))`, after `media_library: …,`):

```ts
    storage_path: m.storage_path ?? null,
    storage_caf_path: m.storage_caf_path ?? null,
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add src/app/api/threads/[studentId]/route.ts
git commit -m "feat(media): thread API returns storage paths"
```

---

### Task 9: Client prefers the stored URL

**Files:**
- Modify: `src/lib/voice-source.ts` (add `voiceStoredUrl`)
- Modify: `src/components/MessageBubble.tsx` (ThreadMsg type ~line 36; `src` ~line 104; VoicePlayer `<audio src>` ~line 381; VoicePlayer props/call site)

- [ ] **Step 1: Add `voiceStoredUrl` to `src/lib/voice-source.ts`**

```ts
import { storagePublicUrl, STUDENT_MEDIA_BUCKET } from "@/lib/storage-url";

/**
 * Direct Supabase-CDN URL for a STORED voice message — zero Vercel bytes.
 * Same Ogg-capable? ogg : caf pick as voiceProxyUrl, but pointed at the
 * public bucket. Falls back to the ogg object if no CAF derivative exists.
 */
export function voiceStoredUrl(storagePath: string, cafPath: string | null): string {
  const path = isOggOpusSupported() ? storagePath : (cafPath ?? storagePath);
  return storagePublicUrl(STUDENT_MEDIA_BUCKET, path);
}
```

- [ ] **Step 2: Extend `ThreadMsg`** in `MessageBubble.tsx` (after `translation_tg_message_id?: number | null;`):

```ts
  storage_path?: string | null;
  storage_caf_path?: string | null;
```

- [ ] **Step 3: Prefer the stored URL for video_note** — change the `src` line (~104):

```ts
  const src = msg.storage_path
    ? mediaPublicUrlStudent(msg.storage_path)
    : `/api/media/${msg.id}?token=${encodeURIComponent(jwt)}`;
```

Add the import at top (reuse the storage-url seam directly):

```ts
import { storagePublicUrl, STUDENT_MEDIA_BUCKET } from "@/lib/storage-url";
```

and define a tiny local helper near the top of the file (keeps the call site readable):

```ts
const mediaPublicUrlStudent = (path: string) => storagePublicUrl(STUDENT_MEDIA_BUCKET, path);
```

- [ ] **Step 4: Prefer the stored URL for voice** — update the VoicePlayer.
  VoicePlayer currently builds `voiceProxyUrl(messageId, jwt)`. Pass the two
  storage fields into VoicePlayer (add `storagePath?: string | null` and
  `storageCafPath?: string | null` to its props and the render site), then set:

```tsx
        src={
          storagePath
            ? voiceStoredUrl(storagePath, storageCafPath ?? null)
            : voiceProxyUrl(messageId, jwt)
        }
```

Import `voiceStoredUrl` alongside the existing `voiceProxyUrl` import.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit && npx vitest run && npx eslint src/components/MessageBubble.tsx src/lib/voice-source.ts
git add src/lib/voice-source.ts src/components/MessageBubble.tsx
git commit -m "feat(media): client serves stored voice/video_note from Supabase, proxy fallback"
```

---

### Task 10: Ship + verify end-to-end

- [ ] **Step 1: Push** (triggers deploy → auto-migration creates the bucket +
  columns, auto-qstash registers the cron):

```bash
git push origin main
```

- [ ] **Step 2: Drain the backlog** — run the cron a few times on the live build:

```bash
CRON_SECRET=$(grep -E '^CRON_SECRET=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')
curl -s -X POST https://hebtut.vercel.app/api/cron/store-media -H "Authorization: Bearer $CRON_SECRET"
# repeat until: {"scanned":>0,"stored":0,"failed":0}  (backlog drained)
```

Expect `stored` to climb on the first runs, then settle to `stored:0`. Any
persistent `failed>0` → check the function logs for the per-message warn.

- [ ] **Step 3: Confirm zero-traffic playback** — open a thread with a stored
  voice on iPhone + Mac:
  - it plays; the bytes load from `*.supabase.co`, not `/api/media`
    (Network tab / the `media.fallback_served` journal stays quiet).
  - a pre-18.4 device pulls the `.caf`.
  - a `video_note` plays from the Supabase URL.

- [ ] **Step 4: Confirm the fallback** — a brand-new voice (before its ~60s
  store window) still plays via `/api/media/[id]`; after the next cron tick it
  flips to Supabase. No broken state in the gap.

- [ ] **Step 5: Close the loop** — disable the Mon 2026-06-15 cloud reminder
  (the deferred public-vs-private decision is now made): the privacy hardening
  is the named follow-up, not an open question.

---

## Self-review notes

- **Spec coverage:** bucket (T1) · schema (T1/T2) · upload seam (T4) + url seam
  (T3) · store core + CAF (T5) · cron incl. `media_library_id IS NULL` guard
  (T6) · schedule (T7) · thread API (T8) · client + proxy fallback (T9) ·
  backlog migration + E2E (T10). All spec sections mapped.
- **Type consistency:** `STUDENT_MEDIA_BUCKET` + `storagePublicUrl` defined once
  in storage-url.ts (T3), imported by media-storage (T4), store-media (T5),
  voice-source + MessageBubble (T9). `voiceStoredUrl(storagePath, cafPath)`
  signature identical at definition (T9 s1) and call site (T9 s4).
- **No placeholders:** every code step is complete. The one prose note (drop the
  `void` line in T5) is explicit.
- **Fallback preserved:** `/api/media/[messageId]` is never touched — pure
  additive change; un-stored rows render exactly as today.
