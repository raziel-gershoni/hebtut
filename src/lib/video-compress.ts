// Client-side video compression via ffmpeg.wasm (single-threaded build, no
// SharedArrayBuffer / COOP / COEP gymnastics). The core wasm is served
// from /ffmpeg/ — copied there at build time by scripts/fetch-ffmpeg.mjs.
//
// Entry point: `prepareVideoForUpload(file, opts)`. Returns the file
// unchanged when it's already under `maxBytes`. Otherwise runs an encoder
// ladder (720p → 480p → 360p) at adaptively-chosen bitrates until the
// output fits, transcoding to H.264 + AAC in MP4. Throws on hard failure
// (OOM, "still too big even at 360p", probe failure, etc.) so the caller
// can show a clear message — no silent crash.
//
// All heavy work happens inside ffmpeg.wasm's internal Worker; the calling
// component only awaits one Promise and receives progress events.

import type { MediaKind } from "@/types/database";

// 40 MB target. 10 MB cushion under TG's 50 MB ceiling — enough to absorb
// libx264's bitrate overshoot at low rates AND ffmpeg's documented `-fs`
// slack ("the size of the output file is slightly more than the requested
// file size"). Don't lower further without measuring quality on a real clip.
export const COMPRESS_TARGET_BYTES = 40 * 1024 * 1024;

// Only TRIGGER compression for files clearly over the TG ceiling. Files
// between target and trigger upload as-is — they're already small enough
// to send through Telegram, and ffmpeg.wasm on a phone burns real minutes
// of CPU per encode. Burning that time to shave 5-10 MB off a 45 MB file
// is bad UX.
export const COMPRESS_TRIGGER_BYTES = 48 * 1024 * 1024;

const CORE_URL = "/ffmpeg/ffmpeg-core.js";
const WASM_URL = "/ffmpeg/ffmpeg-core.wasm";

// One reusable instance per page — loading the core is ~30 MB of wasm so
// we don't want to re-pay it on every upload. Cleared on terminate().
let cached: { instance: unknown; load: Promise<unknown> } | null = null;

interface FfmpegInstance {
  load(opts: { coreURL: string; wasmURL: string }): Promise<boolean>;
  on(event: "progress", handler: (ev: { progress: number; time: number }) => void): void;
  off(event: "progress", handler: (ev: { progress: number; time: number }) => void): void;
  writeFile(name: string, data: Uint8Array): Promise<boolean>;
  readFile(name: string): Promise<Uint8Array | string>;
  exec(args: string[]): Promise<number>;
  terminate(): void;
}

async function getFfmpeg(): Promise<FfmpegInstance> {
  if (cached) {
    try {
      await cached.load;
      return cached.instance as FfmpegInstance;
    } catch (e) {
      // Don't poison the cache forever — clear it so the next call can
      // try again (transient network failure fetching the wasm, for
      // example, is recoverable). Re-throw with a useful message.
      cached = null;
      throw new Error(
        `ffmpeg load failed (cached attempt): ${formatErr(e)}`,
      );
    }
  }
  let mod: typeof import("@ffmpeg/ffmpeg");
  try {
    mod = await import("@ffmpeg/ffmpeg");
  } catch (e) {
    throw new Error(`ffmpeg module import failed: ${formatErr(e)}`);
  }
  const instance = new mod.FFmpeg() as unknown as FfmpegInstance;
  const load = instance.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
  cached = { instance, load };
  try {
    await load;
  } catch (e) {
    cached = null;
    throw new Error(`ffmpeg wasm load failed: ${formatErr(e)}`);
  }
  return instance;
}

export function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || "Error";
  if (typeof e === "string") return e;
  if (e == null) return "undefined";
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export interface CompressProgress {
  /** 0..1 — combined ratio across the encoder ladder. */
  ratio: number;
  /** Currently-running preset label, e.g. "720p". */
  preset: string;
}

export interface PrepareOpts {
  /** Output must be ≤ this many bytes. Defaults to COMPRESS_TARGET_BYTES. */
  maxBytes?: number;
  onProgress?: (p: CompressProgress) => void;
  /** Aborts the in-flight compression. Resolves to a rejection. */
  signal?: AbortSignal;
  /**
   * Produce a Telegram video-note (circular) format: square aspect ratio
   * (center-cropped), 384×384, hard-capped at 60 seconds. Required for
   * `bot.api.sendVideoNote` — TG rejects non-square video-notes outright.
   */
  videoNote?: boolean;
  /**
   * Media-library encoder profile. Mirrors `videoNote`'s single-stage
   * CRF design (which proved stable on iOS WebView) without the square
   * crop or 60 s cap. Preserves aspect ratio, caps height at 720 p, and
   * hard-caps duration at `maxDurationSec` (default 600). Use this for
   * any iOS-bound library upload — the 4-stage CBR ladder kills the
   * Worker on iOS.
   */
  libraryMode?: boolean;
  /**
   * Hard duration cap for `libraryMode`. Source longer than this throws
   * before any ffmpeg work — admin should trim before uploading.
   * Defaults to `LIBRARY_MAX_DURATION_SEC` (600 s / 10 min).
   */
  maxDurationSec?: number;
  /**
   * Pre-probed metadata. When provided, avoids a redundant
   * `probeVideoMetadata` call inside `prepareVideoForUpload`. Required
   * for the `libraryMode` duration pre-check; recommended otherwise.
   */
  meta?: VideoMetadata;
}

/** Square dimension and duration cap for TG video_note format. */
// TG accepts video_notes up to 640×640. We use the max so the circular
// preview in chat is crisp at the player's larger sizes (iOS plays
// video_notes at progressively larger circles as the user taps them).
const VIDEO_NOTE_DIM = 640;
export const VIDEO_NOTE_MAX_DURATION_SEC = 60;
// TG enforces a HARD 12 MiB (12,582,912 bytes) limit on video_notes —
// confirmed via the bot API rejection: "Bad Request: file ... is too
// big for a video note; the maximum size is 12582912 bytes". We aim for
// 11 MB so there's safety margin against container overhead pushing us
// over the cap.
export const VIDEO_NOTE_TARGET_BYTES = 11 * 1024 * 1024;

/**
 * Hard duration cap for media-library video uploads. Anything longer
 * than this is rejected up-front before ffmpeg runs — iOS WebView
 * Workers can't survive unbounded filter graphs and the admin really
 * should trim before uploading a long clip anyway.
 */
export const LIBRARY_MAX_DURATION_SEC = 600;

// We pick resolution from the computed bitrate budget rather than running
// a fixed ladder — long videos need radically lower resolutions to hit
// the size cap, and minimum-bitrate floors would force overshoots.
interface EncodePlan {
  label: string;
  maxHeight: number;
  videoKbps: number;
  audioKbps: number;
}

const SAFETY = 0.85; // aim for 85% of cap; libx264 routinely overshoots by 5–15%.

function planEncoding(durationSec: number, targetBytes: number): EncodePlan {
  const totalKbps = Math.max(
    1,
    Math.floor((targetBytes * 8 * SAFETY) / durationSec / 1000),
  );
  // Audio allocation walks down to garbled-but-intelligible for tight budgets.
  let audioKbps: number;
  if (totalKbps > 600) audioKbps = 96;
  else if (totalKbps > 200) audioKbps = 64;
  else if (totalKbps > 80) audioKbps = 48;
  else audioKbps = 32;
  const videoKbps = Math.max(15, totalKbps - audioKbps);
  // Pick a resolution where this bitrate produces a reasonable image.
  let label: string;
  let maxHeight: number;
  if (videoKbps >= 1500) {
    label = "720p";
    maxHeight = 720;
  } else if (videoKbps >= 800) {
    label = "540p";
    maxHeight = 540;
  } else if (videoKbps >= 400) {
    label = "480p";
    maxHeight = 480;
  } else if (videoKbps >= 200) {
    label = "360p";
    maxHeight = 360;
  } else if (videoKbps >= 80) {
    label = "240p";
    maxHeight = 240;
  } else {
    label = "144p";
    maxHeight = 144;
  }
  return { label, maxHeight, videoKbps, audioKbps };
}

function encodeArgs(
  plan: EncodePlan,
  hardCapBytes: number | null,
  mode: "regular" | "videoNote" | "library",
  libraryDurationCap?: number,
): string[] {
  const videoNote = mode === "videoNote";
  const library = mode === "library";
  // iOS Safari + Telegram Mini App webview is strict about H.264 streams:
  // it needs yuv420p chroma, a constrained-Main / Main profile at level
  // ≤ 4.1, AAC-LC audio (stereo), and `+faststart` moov. Without these the
  // player loads metadata but freezes on a play-button placeholder.
  const args = [
    "-i",
    "input",
    "-c:v",
    "libx264",
    // 'medium' for video_notes + library — predictable Worker scheduling
    // on iOS WebView (`veryfast` pumps frames out faster than the
    // postMessage queue drains and the Worker dies). The cost is real
    // wall time but the encode succeeds.
    "-preset",
    library || videoNote ? "medium" : "veryfast",
    "-profile:v",
    "main",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
  ];
  if (videoNote) {
    // CRF + maxrate sized for TG's 12 MiB video_note ceiling. Math
    // for the 60 s / 11 MB budget:
    //   1400 kbps × 60 s = 10.5 MB (video, cap)
    // +   96 kbps × 60 s = 0.72 MB (audio)
    // + ~1% container overhead
    // ≈ 11.3 MB worst case — under TG's 12 MB hard limit.
    // CRF 20 is libx264's "high quality" recommendation. The encoder
    // uses far less than the maxrate cap for typical talking-head
    // content (~600-900 kbps for 640×640, files come in at 5-7 MB);
    // the cap only bites on complex action footage.
    args.push(
      "-crf",
      "20",
      "-maxrate",
      "1400k",
      "-bufsize",
      "2800k",
    );
  } else if (library) {
    // CRF 23 = visually transparent for typical talking-head /
    // explainer content. maxrate is the duration-derived bandwidth
    // budget so we get a near-target output without 4-stage retries.
    // SAFETY already shaves 15% off the cap inside planEncoding, so
    // there's headroom for libx264 overshoots.
    args.push(
      "-crf",
      "23",
      "-maxrate",
      `${plan.videoKbps}k`,
      "-bufsize",
      `${Math.floor(plan.videoKbps * 2)}k`,
    );
  } else {
    args.push(
      "-b:v",
      `${plan.videoKbps}k`,
      "-maxrate",
      `${Math.floor(plan.videoKbps * 1.15)}k`,
      "-bufsize",
      `${Math.floor(plan.videoKbps * 2)}k`,
    );
  }
  args.push(
    "-vf",
    videoNote
      ? // Video-note: center-crop to the shortest dimension, then scale
        // to a fixed square with lanczos (sharper downscale than the
        // default bicubic). TG video-notes are circular previews of a
        // square source; non-square inputs get an off-center crop
        // without this.
        `crop='min(iw\\,ih)':'min(iw\\,ih)',scale=${VIDEO_NOTE_DIM}:${VIDEO_NOTE_DIM}:flags=lanczos`
      : // Regular + library: scale to max height, auto-width rounded to
        // even, never upscale.
        `scale=-2:${plan.maxHeight}:force_original_aspect_ratio=decrease`,
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    // 96 kbps for video_notes; library uses a fixed 128 kbps; regular
    // keeps the duration-derived value.
    videoNote ? "96k" : library ? "128k" : `${plan.audioKbps}k`,
    "-movflags",
    "+faststart",
  );
  if (videoNote) {
    args.push("-t", String(VIDEO_NOTE_MAX_DURATION_SEC));
  } else if (library && libraryDurationCap) {
    args.push("-t", String(libraryDurationCap));
  }
  if (hardCapBytes != null) {
    // -fs hard-caps the output file size. ffmpeg stops muxing once the
    // limit is hit (the video gets truncated). Use only as a last resort
    // when the bitrate path can't fit on its own.
    args.push("-fs", String(hardCapBytes));
  }
  args.push("-y", "output.mp4");
  return args;
}

/**
 * Returns the video's duration in seconds via a hidden `<video>` element.
 * Required so we can compute a target bitrate. ffmpeg.wasm also exposes
 * a probe path but loading metadata via the DOM is faster and avoids a
 * full wasm round-trip just to read a header.
 */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.muted = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      v.src = "";
    };
    v.addEventListener(
      "loadedmetadata",
      () => {
        const d = v.duration;
        cleanup();
        if (!Number.isFinite(d) || d <= 0) {
          reject(new Error("could not read video duration"));
          return;
        }
        resolve(d);
      },
      { once: true },
    );
    v.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("video metadata load failed"));
      },
      { once: true },
    );
  });
}

/**
 * Public entry. Returns `file` unchanged when small enough; otherwise
 * runs the encoder ladder. Compressed output is always H.264 MP4 named
 * `<stem>.mp4`. Throws `Error("still too large")` if even 360p can't fit.
 */
export async function prepareVideoForUpload(
  file: File,
  opts: PrepareOpts = {},
): Promise<File> {
  const mode: "regular" | "videoNote" | "library" = opts.videoNote
    ? "videoNote"
    : opts.libraryMode
      ? "library"
      : "regular";
  // Video_note mode uses a much tighter byte target — Vercel function
  // timeouts limit how big a file the bot can fetch + upload to TG
  // before being killed, so the output needs to be small enough that
  // the full Supabase→Vercel→TG round-trip completes in a few seconds.
  const maxBytes =
    mode === "videoNote"
      ? VIDEO_NOTE_TARGET_BYTES
      : (opts.maxBytes ?? COMPRESS_TARGET_BYTES);
  // Video-note + library modes ALWAYS re-encode. Regular mode skips the
  // round-trip when the file's already small enough.
  if (mode === "regular" && file.size <= maxBytes) return file;

  const libraryDurationCap =
    mode === "library" ? (opts.maxDurationSec ?? LIBRARY_MAX_DURATION_SEC) : undefined;

  // Library mode: pre-check duration BEFORE invoking ffmpeg. iOS WebView
  // can't survive unbounded filter graphs, so we reject up front and let
  // the admin trim before retrying.
  if (mode === "library" && opts.meta && libraryDurationCap != null) {
    if (opts.meta.duration > libraryDurationCap) {
      throw new Error(
        `video longer than ${libraryDurationCap}s — trim before upload`,
      );
    }
  }

  const duration = opts.meta?.duration ?? (await probeDuration(file));
  // Same library guard, this time using the probed duration when meta
  // wasn't supplied. Cheaper to throw here than after `getFfmpeg()`.
  if (
    mode === "library" &&
    libraryDurationCap != null &&
    duration > libraryDurationCap
  ) {
    throw new Error(
      `video longer than ${libraryDurationCap}s — trim before upload`,
    );
  }

  const ffmpeg = await getFfmpeg();

  // Lazy-import fetchFile only inside the helper that needs it — keeps
  // the eager surface tiny.
  const { fetchFile } = await import("@ffmpeg/util");
  const fetched = await fetchFile(file);
  // Same SharedArrayBuffer concern as on the output side — fetched can be
  // backed by an SAB view in some builds. Copy into a fresh ArrayBuffer.
  const inputData = new Uint8Array(fetched.byteLength);
  inputData.set(fetched);
  await ffmpeg.writeFile("input", inputData);

  const stem = file.name.replace(/\.[^.]+$/, "");
  // Track what went wrong on each stage so the final throw can name the
  // real failure mode instead of the generic "try another file".
  let lastFailure: { reason: string; bytes?: number; label: string } | null = null;
  // Stage ladder for the regular-video path: each retry tightens the
  // target so the bitrate calculation moves down the resolution ladder,
  // final pass adds -fs as a hard cap.
  //
  // Video-note + library modes use a single stage. The CRF+maxrate
  // config in encodeArgs is designed to land under the target on the
  // first try; retries don't help (same CRF, same maxrate, identical
  // output). Single-stage is also crucial on iOS WebView where multi-
  // stage retries can OOM the Worker between exec calls.
  const STAGES: Array<{ targetBytes: number; hardCap: number | null }> =
    mode === "regular"
      ? [
          { targetBytes: maxBytes, hardCap: null },
          { targetBytes: Math.floor(maxBytes * 0.7), hardCap: null },
          { targetBytes: Math.floor(maxBytes * 0.5), hardCap: null },
          { targetBytes: Math.floor(maxBytes * 0.5), hardCap: maxBytes },
        ]
      : [{ targetBytes: maxBytes, hardCap: null }];

  for (let i = 0; i < STAGES.length; i += 1) {
    const stage = STAGES[i];
    if (!stage) break;
    const plan = planEncoding(duration, stage.targetBytes);
    const label = plan.label;

    // Per-stage 0→100% progress. The previous formula divided each stage's
    // progress by STAGES.length, so a successful first-stage encode only
    // ever filled the bar to ~25% — confusing because that's the common
    // case. If a stage fails and we retry at a more aggressive preset
    // (rare), the bar resets to 0% which is honest about what's happening.
    const progressHandler = (ev: { progress: number }) => {
      const localRatio = Math.max(0, Math.min(1, ev.progress));
      opts.onProgress?.({ ratio: localRatio, preset: label });
    };
    ffmpeg.on("progress", progressHandler);

    try {
      if (opts.signal?.aborted) throw new Error("aborted");
      try {
        await ffmpeg.exec(encodeArgs(plan, stage.hardCap, mode, libraryDurationCap));
      } catch (e) {
        // `ffmpeg.exec` rejects with a non-Error / undefined-message
        // object when the underlying Worker dies (OOM, postMessage
        // failure on iOS WebView). Re-throw with a useful message so
        // the caller's fallback decision is informed.
        if (!(e instanceof Error) || !e.message) {
          throw new Error("ffmpeg worker crashed (likely OOM on this device)");
        }
        throw e;
      }
    } finally {
      ffmpeg.off("progress", progressHandler);
    }

    const out = await ffmpeg.readFile("output.mp4");
    if (!(out instanceof Uint8Array)) {
      lastFailure = { reason: "readFile returned non-bytes", label };
      continue;
    }
    if (out.byteLength === 0) {
      lastFailure = { reason: "output is empty (encoder produced 0 bytes)", label };
      continue;
    }
    if (out.byteLength <= maxBytes) {
      // Copy into a fresh ArrayBuffer so the File constructor doesn't
      // see a SharedArrayBuffer-backed view (TS lib types reject that).
      const copy = new Uint8Array(out.byteLength);
      copy.set(out);
      const outFile = new File([copy], `${stem}.mp4`, { type: "video/mp4" });
      opts.onProgress?.({ ratio: 1, preset: label });
      return outFile;
    }
    lastFailure = {
      reason: "output too large for cap",
      bytes: out.byteLength,
      label,
    };
    // Output still over cap → try next stage (tighter target / hard cap).
  }

  // We only reach here if every stage failed. Name the specific failure
  // so callers (and devs scanning logs) know what to do.
  if (lastFailure) {
    const sizeNote =
      lastFailure.bytes != null
        ? ` (got ${(lastFailure.bytes / 1024 / 1024).toFixed(1)} MB, cap ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`
        : "";
    throw new Error(
      `сжатие не удалось на ${lastFailure.label}: ${lastFailure.reason}${sizeNote}`,
    );
  }
  throw new Error("сжатие не удалось — попробуй другой файл");
}

/** True for the MIME types the compression pipeline knows how to ingest. */
export function isCompressibleVideo(mime: string, kind: MediaKind | null): boolean {
  if (kind !== "video") return false;
  // ffmpeg.wasm can demux all three, output stays MP4.
  return mime === "video/mp4" || mime === "video/quicktime" || mime === "video/webm";
}

/**
 * Tests whether the browser's <video> element can load the file. Resolves
 * true if metadata loads (file is playable), false on decode/load error or
 * a 10-second timeout.
 *
 * Used to decide whether to bypass ffmpeg.wasm for an already-iOS-compat
 * file. DJI drones, some phone cameras, and HDR-aware recordings emit
 * H.265 / 10-bit / unusual chroma which Safari's direct-navigation player
 * handles but the <video> element rejects with SRC_NOT_SUPPORTED.
 */
export function isVideoPlayableByBrowser(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.src = "";
      resolve(ok);
    };
    v.addEventListener("loadedmetadata", () => finish(true), { once: true });
    v.addEventListener("error", () => finish(false), { once: true });
    setTimeout(() => finish(false), 10_000);
    v.src = url;
  });
}

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

/**
 * Reads dimensions + duration from the file via a hidden <video> element.
 * Returns null if metadata can't load (codec the browser doesn't grok,
 * corrupt file, 10-second timeout). The same call effectively proves
 * iOS-WebKit decode compatibility — if metadata loaded, the file is
 * playable in the same engine that'll render the admin preview.
 *
 * Used by the onboarding upload to skip ffmpeg.wasm entirely when the
 * source is already a valid video_note (square + ≤60 s + small enough).
 */
export function probeVideoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let done = false;
    const finish = (m: VideoMetadata | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.src = "";
      resolve(m);
    };
    v.addEventListener(
      "loadedmetadata",
      () => {
        const w = v.videoWidth;
        const h = v.videoHeight;
        const d = v.duration;
        if (!Number.isFinite(d) || d <= 0 || !w || !h) {
          finish(null);
          return;
        }
        finish({ width: w, height: h, duration: d });
      },
      { once: true },
    );
    v.addEventListener("error", () => finish(null), { once: true });
    setTimeout(() => finish(null), 10_000);
    v.src = url;
  });
}
