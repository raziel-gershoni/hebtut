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
import { tusUpload } from "@/lib/direct-upload";
import { publicEnv } from "@/lib/env";
import type { OnboardingVideoStep } from "@/types/database";

const BUCKET = "media-library";
const MAX_CLIPS_PER_STEP = 10;

function publicUrlFor(storagePath: string): string {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

interface Clip {
  id: number;
  position: number;
  storage_path: string;
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
> = {
  video1: {
    title: "Видео 1",
    when: "После кнопки «Привет» — первый блок онбординга.",
  },
  video2: {
    title: "Видео 2",
    when: "После видео 1 — перед вопросом про имя.",
  },
  video3: {
    title: "Видео 3",
    when: "Через ~5 минут после первого ответа тренера — мини-объяснялка.",
  },
};

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
      setError("не удалось загрузить");
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
        setError(`не удалось подготовить видео: ${(e as Error).message}`);
        return;
      }
    }
    setCompressing(null);
    if (fileToSend.size > MAX_BYTES) {
      setBusy(null);
      setUploadingStep(null);
      setError(
        `после сжатия файл всё ещё ${formatBytes(fileToSend.size)} — попробуй обрезать клип`,
      );
      return;
    }
    let bucket: string;
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
        setError(
          urlRes.status === 415
            ? "только mp4 / mov / webm"
            : `не удалось получить путь для загрузки: ${urlRes.status}`,
        );
        return;
      }
      const d = (await urlRes.json()) as { bucket: string; path: string };
      bucket = d.bucket;
      path = d.path;
    }
    setUploading({ loaded: 0, total: fileToSend.size });
    try {
      await tusUpload(fileToSend, {
        bucket,
        path,
        jwt,
        onProgress: (loaded, total) => setUploading({ loaded, total }),
      });
    } catch (e) {
      setBusy(null);
      setUploadingStep(null);
      setUploading(null);
      setError(`не удалось загрузить файл в хранилище: ${(e as Error).message}`);
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
      setError(
        body.startsWith("max clips")
          ? `больше ${MAX_CLIPS_PER_STEP} клипов на шаг нельзя`
          : `не удалось зарегистрировать загрузку: ${body || r.statusText}`,
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
      setError("не удалось удалить");
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
      setError("не удалось переместить");
      return;
    }
    await load();
  }

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Видео онбординга</h2>
      <p className="text-xs text-tg-text-hint">
        Бот отправляет ученику как круглое видео-сообщение (TG video_note).
        Каждый файл автоматически обрезается по центру в квадрат 640×640 и
        до 60 секунд. Можно загрузить до {MAX_CLIPS_PER_STEP} клипов в один
        шаг — бот пришлёт первый сразу, остальные подтянутся через
        фоновый воркер с интервалом &lt; 1 минуты (создаётся ощущение, что
        видео записываются в реальном времени). Кодирование в браузере
        занимает несколько минут на файл ради максимального качества.
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
        title={pendingDelete ? `Удалить клип #${pendingDelete.position}?` : ""}
        body="Если это был единственный клип в шаге, бот снова будет показывать текст-заглушку, пока не загрузишь новое."
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
          Не загружено — пока используется текст-заглушка.
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
          {addingToThisStep ? <Spinner size={12} /> : "+ Добавить клип"}
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
  const signedSrc = publicUrlFor(clip.storage_path);

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
            aria-label="Переместить вверх"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={isLast || busy || disabledByOther}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-tg-bg-secondary text-tg-text text-sm transition-transform active:scale-95 disabled:opacity-30"
            aria-label="Переместить вниз"
          >
            ↓
          </button>
        </div>
      </div>

      <video
        key={signedSrc}
        src={signedSrc}
        controls
        playsInline
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
          видео не загружается: {videoError}
        </div>
      )}

      <div className="text-[11px] text-tg-text-hint truncate flex items-center gap-2">
        <span className="truncate" title={clip.original_filename}>
          {clip.original_filename} · {formatBytes(clip.bytes)}
          {clip.duration_seconds != null && ` · ${clip.duration_seconds}s`}
        </span>
        <a
          href={signedSrc}
          target="_blank"
          rel="noreferrer"
          className="text-tg-text-link shrink-0"
        >
          открыть
        </a>
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
          {busy ? <Spinner size={12} /> : "Заменить"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || disabledByOther}
          className="inline-flex items-center h-8 px-3 rounded-full bg-tg-bg-section text-tg-text-destructive text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
        >
          Удалить
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
            <span>Сжимаем видео ({compressing.preset})…</span>
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
            <span>
              Загружаем… {formatBytes(uploading.loaded)} / {formatBytes(uploading.total)}
            </span>
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
    setError("только mp4 / mov / webm");
    return false;
  }
  if (f.size <= 0) {
    setError("пустой файл");
    return false;
  }
  if (f.size > 4 * 1024 * 1024 * 1024) {
    setError(`файл больше ${formatBytes(4 * 1024 * 1024 * 1024)}`);
    return false;
  }
  return true;
}
