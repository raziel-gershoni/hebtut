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

export const COMPRESS_TARGET_BYTES = 48 * 1024 * 1024; // 48 MB — leave 2 MB headroom under TG's 50 MB ceiling.

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

// 720p → 480p → 360p. Each preset also caps the audio bitrate; the video
// bitrate is computed from the video's duration so the OUTPUT lands close
// to the target without needing a true two-pass. Conservative — we'd
// rather slightly undershoot than overshoot.
const LADDER = [
  { label: "720p", maxHeight: 720, audioBitrateKbps: 96, minVideoBitrateKbps: 400 },
  { label: "480p", maxHeight: 480, audioBitrateKbps: 80, minVideoBitrateKbps: 250 },
  { label: "360p", maxHeight: 360, audioBitrateKbps: 64, minVideoBitrateKbps: 150 },
] as const;

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

  let lastSize = file.size;
  for (let i = 0; i < LADDER.length; i += 1) {
    const preset = LADDER[i];
    if (!preset) break;
    // Compute video bitrate to hit the target. Account for audio overhead.
    const targetBits = maxBytes * 8;
    const audioBits = preset.audioBitrateKbps * 1000 * duration;
    let videoKbps = Math.max(
      preset.minVideoBitrateKbps,
      Math.floor((targetBits - audioBits) / 1000 / duration),
    );
    // Sanity cap so we don't ask for absurd bitrates on tiny clips.
    videoKbps = Math.min(videoKbps, 6000);

    const label = preset.label;
    const progressHandler = (ev: { progress: number }) => {
      const localRatio = Math.max(0, Math.min(1, ev.progress));
      // Each preset gets 1/3 of the bar. So preset 0 maps 0..0.33, etc.
      const ratio = (i + localRatio) / LADDER.length;
      opts.onProgress?.({ ratio, preset: label });
    };
    ffmpeg.on("progress", progressHandler);

    try {
      if (opts.signal?.aborted) throw new Error("aborted");
      await ffmpeg.exec([
        "-i",
        "input",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${Math.floor(videoKbps * 1.2)}k`,
        "-bufsize",
        `${Math.floor(videoKbps * 2)}k`,
        "-vf",
        `scale='min(iw,trunc(oh*iw/ih/2)*2)':'min(ih,${preset.maxHeight})':force_original_aspect_ratio=decrease`,
        "-c:a",
        "aac",
        "-b:a",
        `${preset.audioBitrateKbps}k`,
        "-movflags",
        "+faststart",
        "-y",
        "output.mp4",
      ]);
    } finally {
      ffmpeg.off("progress", progressHandler);
    }

    const out = await ffmpeg.readFile("output.mp4");
    if (!(out instanceof Uint8Array)) {
      throw new Error("ffmpeg produced unexpected output");
    }
    lastSize = out.byteLength;
    if (out.byteLength <= maxBytes) {
      const stem = file.name.replace(/\.[^.]+$/, "");
      // Copy into a fresh ArrayBuffer so the File constructor doesn't
      // see a SharedArrayBuffer-backed view (TS lib types reject that).
      const copy = new Uint8Array(out.byteLength);
      copy.set(out);
      const outFile = new File([copy], `${stem}.mp4`, { type: "video/mp4" });
      opts.onProgress?.({ ratio: 1, preset: label });
      return outFile;
    }
    // else: fall through to the next preset
  }

  throw new Error(
    `still too large after maximum compression (${(lastSize / 1024 / 1024).toFixed(1)} MB > ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`,
  );
}

/** True for the MIME types the compression pipeline knows how to ingest. */
export function isCompressibleVideo(mime: string, kind: MediaKind | null): boolean {
  if (kind !== "video") return false;
  // ffmpeg.wasm can demux all three, output stays MP4.
  return mime === "video/mp4" || mime === "video/quicktime" || mime === "video/webm";
}
