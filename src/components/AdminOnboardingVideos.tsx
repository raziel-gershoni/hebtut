"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { MAX_BYTES, formatBytes } from "@/lib/media";
import {
  VIDEO_NOTE_MAX_DURATION_SEC,
  VIDEO_NOTE_TARGET_BYTES,
  prepareVideoForUpload,
  probeVideoMetadata,
  type CompressProgress,
} from "@/lib/video-compress";
import { putToPresignedUrl } from "@/lib/direct-upload";
import { ru } from "@/lib/i18n";
import { extractFfmpegLogTail, reportClientMediaError } from "@/lib/diag";
import type { OnboardingVideoStep } from "@/types/database";

const MAX_CLIPS_PER_STEP = 10;

interface Clip {
  id: number;
  position: number;
  storage_path: string;
  /** Server-minted presigned R2 GET URL (6h) — the preview plays from this
   * directly (no Supabase public URL, no proxy). Supplied by the list API;
   * may be undefined if that one clip's presign threw server-side. */
  url?: string;
  original_filename: string;
  mime_type: string;
  bytes: number;
  duration_seconds: number | null;
  uploaded_at: string;
  uploaded_by_user_id: number;
}

interface Slot {
  step: OnboardingVideoStep;
  clips: Clip[];
}

const ACCEPT = "video/mp4,video/quicktime,video/webm";
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const SLOT_META: Record<
  OnboardingVideoStep,
  { title: string; when: string }
> = ru.admin.onboardingVideos.slotMeta;

const STEPS: readonly OnboardingVideoStep[] = ["video1", "video2", "video3"];

interface Props {
  jwt: string;
}

type BusyKey = { clipId: number | null } | null;

export function AdminOnboardingVideos({ jwt }: Props) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState<BusyKey>(null);
  // Which step is currently uploading a NEW clip (no clip card exists yet)
  // — drives where the compress/upload progress bars render. For Replace,
  // the existing ClipCard already shows progress via busy.clipId match.
  const [uploadingStep, setUploadingStep] = useState<OnboardingVideoStep | null>(null);
  const [compressing, setCompressing] = useState<CompressProgress | null>(null);
  const [uploading, setUploading] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Clip | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/onboarding-videos", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError(ru.admin.onboardingVideos.loadFailed);
      return;
    }
    const d = (await r.json()) as { slots: Slot[] };
    setSlots(d.slots);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Upload a clip. `targetClipId` is set when Replacing an existing clip
   * (the position is reused); null when Adding a new clip (position picked
   * server-side as max+1).
   */
  async function upload(
    step: OnboardingVideoStep,
    targetPosition: number | null,
    targetClipId: number | null,
    file: File,
  ) {
    setBusy({ clipId: targetClipId });
    // Track step only for the add-new case so StepSection knows where to
    // render progress. Replace already has a ClipCard hosting its own bars.
    if (targetClipId == null) setUploadingStep(step);
    setError(null);
    let fileToSend: File = file;
    // Probe the source first. If it's ALREADY a valid video_note (square
    // dimensions, ≤60 s, ≤target bytes, mp4), skip ffmpeg.wasm entirely.
    const meta = await probeVideoMetadata(file);
    const alreadyValidVideoNote =
      file.type === "video/mp4" &&
      meta != null &&
      meta.width === meta.height &&
      meta.duration <= VIDEO_NOTE_MAX_DURATION_SEC &&
      file.size <= VIDEO_NOTE_TARGET_BYTES;
    if (!alreadyValidVideoNote) {
      setCompressing({ ratio: 0, preset: "video-note 384²" });
      try {
        fileToSend = await prepareVideoForUpload(file, {
          videoNote: true,
          onProgress: (p) => setCompressing(p),
        });
      } catch (e) {
        setBusy(null);
        setUploadingStep(null);
        setCompressing(null);
        void reportClientMediaError(
          "compress",
          e,
          {
            size_bytes: file.size,
            mime: file.type,
            name: file.name,
            surface: "onboarding-videos",
            ffmpeg_log_tail: extractFfmpegLogTail(e),
          },
          jwt,
        );
        setError(ru.admin.onboardingVideos.prepFailed((e as Error).message));
        return;
      }
    }
    setCompressing(null);
    if (fileToSend.size > MAX_BYTES) {
      setBusy(null);
      setUploadingStep(null);
      void reportClientMediaError(
        "compress",
        new Error(`compressed output ${fileToSend.size}B still over cap`),
        {
          size_bytes: fileToSend.size,
          original_size_bytes: file.size,
          mime: fileToSend.type,
          name: fileToSend.name,
          surface: "onboarding-videos",
        },
        jwt,
      );
      setError(ru.admin.onboardingVideos.stillTooLarge(formatBytes(fileToSend.size)));
      return;
    }
    // 1. Ask the server for a fresh storage path + a presigned R2 PUT URL.
    //    2. PUT the bytes straight to R2 — no proxy hop, no Supabase. The
    //    Content-Type MUST match the type the URL was signed with
    //    (fileToSend.type), or R2 rejects the PUT. 3. POST metadata below.
    let putUrl: string;
    let path: string;
    {
      const urlRes = await fetch(
        `/api/admin/onboarding-videos/${step}/upload-url`,
        {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mime_type: fileToSend.type,
            ...(targetPosition != null ? { position: targetPosition } : {}),
          }),
        },
      );
      if (!urlRes.ok) {
        setBusy(null);
        setUploadingStep(null);
        void reportClientMediaError(
          "upload-presign",
          new Error(`presign HTTP ${urlRes.status}`),
          {
            size_bytes: fileToSend.size,
            mime: fileToSend.type,
            name: fileToSend.name,
            http_status: urlRes.status,
            surface: "onboarding-videos",
          },
          jwt,
        );
        setError(
          urlRes.status === 415
            ? ru.admin.onboardingVideos.unsupportedMime
            : ru.admin.onboardingVideos.presignFailed(urlRes.status),
        );
        return;
      }
      const d = (await urlRes.json()) as { url: string; path: string };
      putUrl = d.url;
      path = d.path;
    }
    setUploading({ loaded: 0, total: fileToSend.size });
    try {
      await putToPresignedUrl(putUrl, fileToSend, fileToSend.type, (loaded, total) =>
        setUploading({ loaded, total }),
      );
    } catch (e) {
      setBusy(null);
      setUploadingStep(null);
      setUploading(null);
      void reportClientMediaError(
        "upload-put",
        e,
        {
          size_bytes: fileToSend.size,
          mime: fileToSend.type,
          name: fileToSend.name,
          storage_path: path,
          surface: "onboarding-videos",
        },
        jwt,
      );
      setError(ru.admin.onboardingVideos.uploadFailed((e as Error).message));
      return;
    }
    setUploading(null);
    const r = await fetch(`/api/admin/onboarding-videos/${step}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storage_path: path,
        mime_type: fileToSend.type,
        original_filename: fileToSend.name,
        bytes: fileToSend.size,
        ...(targetPosition != null ? { position: targetPosition } : {}),
      }),
    });
    setBusy(null);
    setUploadingStep(null);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      void reportClientMediaError(
        "register",
        new Error(`register HTTP ${r.status}: ${body || r.statusText}`),
        {
          size_bytes: fileToSend.size,
          mime: fileToSend.type,
          name: fileToSend.name,
          storage_path: path,
          http_status: r.status,
          surface: "onboarding-videos",
        },
        jwt,
      );
      setError(
        body.startsWith("max clips")
          ? ru.admin.onboardingVideos.capReached(MAX_CLIPS_PER_STEP)
          : ru.admin.onboardingVideos.registerFailed(body || r.statusText),
      );
      return;
    }
    await load();
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const clip = pendingDelete;
    setPendingDelete(null);
    setBusy({ clipId: clip.id });
    const r = await fetch(`/api/admin/onboarding-video-clips/${clip.id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    setBusy(null);
    if (!r.ok) {
      setError(ru.admin.onboardingVideos.deleteFailed);
      return;
    }
    await load();
  }

  async function move(clip: Clip, direction: "up" | "down") {
    setBusy({ clipId: clip.id });
    const r = await fetch(`/api/admin/onboarding-video-clips/${clip.id}/move`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ direction }),
    });
    setBusy(null);
    if (!r.ok) {
      setError(ru.admin.onboardingVideos.moveFailed);
      return;
    }
    await load();
  }

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{ru.admin.onboardingVideos.sectionTitle}</h2>
      <p className="text-xs text-tg-text-hint">
        {ru.admin.onboardingVideos.description(MAX_CLIPS_PER_STEP)}
      </p>
      {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
      {slots === null ? (
        <div className="py-6 text-center"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          {STEPS.map((step) => {
            const slot = slots.find((s) => s.step === step) ?? { step, clips: [] };
            return (
              <StepSection
                key={step}
                step={step}
                clips={slot.clips}
                busyClipId={busy?.clipId ?? null}
                anyBusy={busy != null}
                addingToThisStep={uploadingStep === step}
                compressing={compressing}
                uploading={uploading}
                onAdd={(file) => void upload(step, null, null, file)}
                onReplace={(clip, file) => void upload(step, clip.position, clip.id, file)}
                onDeleteRequest={(clip) => setPendingDelete(clip)}
                onMove={(clip, dir) => void move(clip, dir)}
              />
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? ru.admin.onboardingVideos.deleteConfirmTitle(pendingDelete.position) : ""}
        body={ru.admin.onboardingVideos.deleteConfirmBody}
        onCancel={() => setPendingDelete(null)}
        onConfirm={performDelete}
      />
    </section>
  );
}

function StepSection({
  step,
  clips,
  busyClipId,
  anyBusy,
  addingToThisStep,
  compressing,
  uploading,
  onAdd,
  onReplace,
  onDeleteRequest,
  onMove,
}: {
  step: OnboardingVideoStep;
  clips: Clip[];
  busyClipId: number | null;
  anyBusy: boolean;
  addingToThisStep: boolean;
  compressing: CompressProgress | null;
  uploading: { loaded: number; total: number } | null;
  onAdd: (file: File) => void;
  onReplace: (clip: Clip, file: File) => void;
  onDeleteRequest: (clip: Clip) => void;
  onMove: (clip: Clip, direction: "up" | "down") => void;
}) {
  const meta = SLOT_META[step];
  const addInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const atCap = clips.length >= MAX_CLIPS_PER_STEP;

  function pickNew() {
    setLocalError(null);
    addInputRef.current?.click();
  }

  function onNewFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!validateFile(f, setLocalError)) return;
    onAdd(f!);
  }

  return (
    <div className="rounded-xl bg-tg-bg-secondary p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">
          {meta.title}{" "}
          <span className="text-tg-text-hint font-normal">
            · {clips.length}/{MAX_CLIPS_PER_STEP}
          </span>
        </div>
        <div className="text-xs text-tg-text-hint">{meta.when}</div>
      </div>

      {clips.length === 0 ? (
        <div className="text-xs text-tg-text-hint italic">
          {ru.admin.onboardingVideos.emptyStep}
        </div>
      ) : (
        <ol className="space-y-2">
          {clips.map((clip, idx) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              isFirst={idx === 0}
              isLast={idx === clips.length - 1}
              busy={busyClipId === clip.id}
              disabledByOther={anyBusy && busyClipId !== clip.id}
              compressing={busyClipId === clip.id ? compressing : null}
              uploading={busyClipId === clip.id ? uploading : null}
              onReplace={(file) => onReplace(clip, file)}
              onDelete={() => onDeleteRequest(clip)}
              onMove={(dir) => onMove(clip, dir)}
            />
          ))}
        </ol>
      )}

      {addingToThisStep && (compressing || uploading) && (
        <ProgressBars compressing={compressing} uploading={uploading} />
      )}

      {localError && (
        <div className="text-xs text-tg-text-destructive">{localError}</div>
      )}

      <div className="pt-1">
        <button
          type="button"
          onClick={pickNew}
          disabled={atCap || anyBusy}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
        >
          {addingToThisStep ? <Spinner size={12} /> : ru.admin.onboardingVideos.addClipButton}
        </button>
      </div>

      <input
        ref={addInputRef}
        type="file"
        accept={ACCEPT}
        onChange={onNewFile}
        className="hidden"
      />
    </div>
  );
}

function ClipCard({
  clip,
  isFirst,
  isLast,
  busy,
  disabledByOther,
  compressing,
  uploading,
  onReplace,
  onDelete,
  onMove,
}: {
  clip: Clip;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  disabledByOther: boolean;
  compressing: CompressProgress | null;
  uploading: { loaded: number; total: number } | null;
  onReplace: (file: File) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  // Server-provided presigned R2 GET URL (no Supabase public URL). Undefined
  // only if this clip's presign threw server-side — the <video> then renders
  // empty and surfaces the load-failed hint.
  const signedSrc = clip.url;

  function pickReplace() {
    setLocalError(null);
    replaceInputRef.current?.click();
  }

  function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!validateFile(f, setLocalError)) return;
    onReplace(f!);
  }

  return (
    <li className="rounded-lg bg-tg-bg-section p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-tg-text-hint tabular-nums shrink-0">
          #{clip.position}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={isFirst || busy || disabledByOther}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-tg-bg-secondary text-tg-text text-sm transition-transform active:scale-95 disabled:opacity-30"
            aria-label={ru.admin.onboardingVideos.moveUpAriaLabel}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={isLast || busy || disabledByOther}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-tg-bg-secondary text-tg-text text-sm transition-transform active:scale-95 disabled:opacity-30"
            aria-label={ru.admin.onboardingVideos.moveDownAriaLabel}
          >
            ↓
          </button>
        </div>
      </div>

      <video
        key={signedSrc}
        // #t=0.1 nudges iOS Safari into rendering the first frame as a poster
        // — without it the preview is black until the user plays (matches the
        // media-library tiles).
        src={signedSrc ? `${signedSrc}#t=0.1` : undefined}
        controls
        playsInline
        muted
        preload="metadata"
        onError={(e) => {
          const err = e.currentTarget.error;
          if (err) {
            const codes: Record<number, string> = {
              1: "ABORTED",
              2: "NETWORK",
              3: "DECODE",
              4: "SRC_NOT_SUPPORTED",
            };
            setVideoError(`${codes[err.code] ?? "UNKNOWN"} · ${err.message || "—"}`);
          }
        }}
        onLoadedMetadata={() => setVideoError(null)}
        className="block w-full max-w-sm max-h-32 rounded-lg bg-black"
      />
      {videoError && (
        <div className="text-[11px] text-tg-text-destructive">
          {ru.admin.onboardingVideos.videoLoadFailedPrefix} {videoError}
        </div>
      )}

      <div className="text-[11px] text-tg-text-hint truncate flex items-center gap-2">
        <span className="truncate" title={clip.original_filename}>
          {clip.original_filename} · {formatBytes(clip.bytes)}
          {clip.duration_seconds != null && ` · ${clip.duration_seconds}s`}
        </span>
        {signedSrc && (
          <a
            href={signedSrc}
            target="_blank"
            rel="noreferrer"
            className="text-tg-text-link shrink-0"
          >
            {ru.admin.onboardingVideos.openInBrowser}
          </a>
        )}
      </div>

      <ProgressBars compressing={compressing} uploading={uploading} />

      {localError && (
        <div className="text-xs text-tg-text-destructive">{localError}</div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={pickReplace}
          disabled={busy || disabledByOther}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
        >
          {busy ? <Spinner size={12} /> : ru.admin.onboardingVideos.replaceButton}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || disabledByOther}
          className="inline-flex items-center h-8 px-3 rounded-full bg-tg-bg-section text-tg-text-destructive text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
        >
          {ru.admin.onboardingVideos.deleteClipButton}
        </button>
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPT}
        onChange={onReplaceFile}
        className="hidden"
      />
    </li>
  );
}

function ProgressBars({
  compressing,
  uploading,
}: {
  compressing: CompressProgress | null;
  uploading: { loaded: number; total: number } | null;
}) {
  if (!compressing && !uploading) return null;
  const compressPct = compressing ? Math.round(compressing.ratio * 100) : 0;
  const uploadPct = uploading
    ? Math.min(100, Math.round((uploading.loaded / Math.max(1, uploading.total)) * 100))
    : 0;
  return (
    <div className="space-y-2">
      {compressing && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-xs text-tg-text">
            <span>{ru.admin.onboardingVideos.compressingLabel(compressing.preset)}</span>
            <span className="tabular-nums">{compressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-tg-text-accent transition-[width] duration-150 ease-linear"
              style={{ width: `${compressPct}%` }}
            />
          </div>
        </div>
      )}
      {uploading && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-xs text-tg-text">
            <span>{ru.admin.onboardingVideos.uploadingLabel(formatBytes(uploading.loaded), formatBytes(uploading.total))}</span>
            <span className="tabular-nums">{uploadPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-tg-text-accent transition-[width] duration-150 ease-linear"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function validateFile(
  f: File | null,
  setError: (s: string | null) => void,
): boolean {
  if (!f) return false;
  if (!VIDEO_MIMES.has(f.type)) {
    setError(ru.admin.onboardingVideos.unsupportedMime);
    return false;
  }
  if (f.size <= 0) {
    setError(ru.admin.onboardingVideos.fileEmpty);
    return false;
  }
  if (f.size > 4 * 1024 * 1024 * 1024) {
    setError(ru.admin.onboardingVideos.fileTooLarge(formatBytes(4 * 1024 * 1024 * 1024)));
    return false;
  }
  return true;
}
