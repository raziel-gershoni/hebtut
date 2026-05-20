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
    await cached.load;
    return cached.instance as FfmpegInstance;
  }
  const mod = await import("@ffmpeg/ffmpeg");
  const instance = new mod.FFmpeg() as unknown as FfmpegInstance;
  const load = instance.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
  cached = { instance, load };
  await load;
  return instance;
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
}

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

function encodeArgs(plan: EncodePlan, hardCapBytes: number | null): string[] {
  // iOS Safari + Telegram Mini App webview is strict about H.264 streams:
  // it needs yuv420p chroma, a constrained-Main / Main profile at level
  // ≤ 4.1, AAC-LC audio (stereo), and `+faststart` moov. Without these the
  // player loads metadata but freezes on a play-button placeholder.
  // The scale filter uses `-2:H` so the width is auto-computed to keep
  // aspect ratio and rounded to an even number (H.264 requires even
  // dimensions); `force_original_aspect_ratio=decrease` ensures we never
  // upscale a short clip.
  const args = [
    "-i",
    "input",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${plan.videoKbps}k`,
    "-maxrate",
    `${Math.floor(plan.videoKbps * 1.15)}k`,
    "-bufsize",
    `${Math.floor(plan.videoKbps * 2)}k`,
    "-vf",
    `scale=-2:${plan.maxHeight}:force_original_aspect_ratio=decrease`,
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    `${plan.audioKbps}k`,
    "-movflags",
    "+faststart",
  ];
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
  const maxBytes = opts.maxBytes ?? COMPRESS_TARGET_BYTES;
  if (file.size <= maxBytes) return file;

  const duration = await probeDuration(file);
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
  // Each retry tightens the target so the bitrate calculation moves down
  // the resolution ladder. The final pass adds ffmpeg's -fs hard cap so
  // the output is ALWAYS ≤ maxBytes — even for multi-hour input the file
  // will fit (the encoder truncates the tail to stay under the cap).
  const STAGES: Array<{ targetBytes: number; hardCap: number | null }> = [
    { targetBytes: maxBytes, hardCap: null },
    { targetBytes: Math.floor(maxBytes * 0.7), hardCap: null },
    { targetBytes: Math.floor(maxBytes * 0.5), hardCap: null },
    { targetBytes: Math.floor(maxBytes * 0.5), hardCap: maxBytes },
  ];

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
      await ffmpeg.exec(encodeArgs(plan, stage.hardCap));
    } finally {
      ffmpeg.off("progress", progressHandler);
    }

    const out = await ffmpeg.readFile("output.mp4");
    if (!(out instanceof Uint8Array) || out.byteLength === 0) {
      // Try next stage; if even the final hard-cap pass fails to produce
      // anything, we'll fall through and throw below.
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
    // Output still over cap → try next stage (tighter target / hard cap).
  }

  // We only reach here if even the -fs hard-cap pass produced nothing
  // usable — typically a corrupt input or an OOM in the worker.
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
