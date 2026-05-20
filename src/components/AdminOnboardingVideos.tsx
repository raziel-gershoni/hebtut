"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { MAX_BYTES, formatBytes } from "@/lib/media";
import {
  prepareVideoForUpload,
  type CompressProgress,
} from "@/lib/video-compress";
import { tusUpload } from "@/lib/direct-upload";
import { publicEnv } from "@/lib/env";
import type { OnboardingVideoStep } from "@/types/database";

const BUCKET = "media-library";

function publicUrlFor(storagePath: string): string {
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

type Slot =
  | { step: OnboardingVideoStep; present: false }
  | {
      step: OnboardingVideoStep;
      present: true;
      storage_path: string;
      original_filename: string;
      mime_type: string;
      bytes: number;
      duration_seconds: number | null;
      uploaded_at: string;
      uploaded_by_user_id: number;
    };

const ACCEPT = "video/mp4,video/quicktime,video/webm";
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const SLOT_META: Record<
  OnboardingVideoStep,
  { title: string; when: string }
> = {
  video1: {
    title: "Видео 1",
    when: "После кнопки «Привет» — первое видео онбординга.",
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

export function AdminOnboardingVideos({ jwt }: Props) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busyStep, setBusyStep] = useState<OnboardingVideoStep | null>(null);
  const [compressing, setCompressing] = useState<CompressProgress | null>(null);
  const [uploading, setUploading] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OnboardingVideoStep | null>(null);

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

  async function upload(step: OnboardingVideoStep, file: File) {
    setBusyStep(step);
    setError(null);
    let fileToSend: File = file;
    // Onboarding videos are sent as TG video_notes (round previews).
    // ALWAYS re-encode through ffmpeg: video_notes must be square (we
    // center-crop to 384×384) and ≤60 s (we hard-cap). No fast-path for
    // small inputs — we still need the shape/duration transform.
    setCompressing({ ratio: 0, preset: "video-note 384²" });
    try {
      fileToSend = await prepareVideoForUpload(file, {
        videoNote: true,
        onProgress: (p) => setCompressing(p),
      });
    } catch (e) {
      setBusyStep(null);
      setCompressing(null);
      setError(`не удалось подготовить видео: ${(e as Error).message}`);
      return;
    }
    setCompressing(null);
    if (fileToSend.size > MAX_BYTES) {
      setBusyStep(null);
      setError(
        `после сжатия файл всё ещё ${formatBytes(fileToSend.size)} — попробуй обрезать клип`,
      );
      return;
    }
    // 1. Ask the server for a fresh storage path (admin gate + path
    //    generation). 2. TUS-upload the bytes through our proxy
    //    (/api/admin/upload-proxy) which forwards each 4 MB chunk to
    //    Supabase with the service-role key — chunks stay under Vercel's
    //    4.5 MB function body limit, and TUS resumes on a flaky network
    //    instead of restarting. 3. POST metadata to register the row.
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
          body: JSON.stringify({ mime_type: fileToSend.type }),
        },
      );
      if (!urlRes.ok) {
        setBusyStep(null);
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
      setBusyStep(null);
      setUploading(null);
      setError(`не удалось загрузить файл в хранилище: ${(e as Error).message}`);
      return;
    }
    setUploading(null);
    const signed = { bucket, path };
    const r = await fetch(`/api/admin/onboarding-videos/${step}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storage_path: signed.path,
        mime_type: fileToSend.type,
        original_filename: fileToSend.name,
        bytes: fileToSend.size,
      }),
    });
    setBusyStep(null);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      setError(
        body.startsWith("uploaded object missing")
          ? "загрузка в хранилище не дошла — попробуй ещё раз"
          : `не удалось зарегистрировать загрузку: ${body || r.statusText}`,
      );
      return;
    }
    await load();
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const step = pendingDelete;
    setPendingDelete(null);
    setBusyStep(step);
    const r = await fetch(`/api/admin/onboarding-videos/${step}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    setBusyStep(null);
    if (!r.ok) {
      setError("не удалось удалить");
      return;
    }
    await load();
  }

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Видео онбординга</h2>
      <p className="text-xs text-tg-text-hint">
        Бот отправляет ученику как круглое видео-сообщение (TG video_note).
        Файл автоматически обрежется по центру в квадрат 384×384 и
        обрежется до 60 секунд. Если слот пустой — бот шлёт текст-заглушку.
      </p>
      {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
      {slots === null ? (
        <div className="py-6 text-center"><Spinner /></div>
      ) : (
        <div className="space-y-3">
          {STEPS.map((step) => {
            const slot = slots.find((s) => s.step === step) ?? { step, present: false };
            return (
              <SlotCard
                key={step}
                jwt={jwt}
                slot={slot}
                busy={busyStep === step}
                compressing={busyStep === step ? compressing : null}
                uploading={busyStep === step ? uploading : null}
                disabledByOther={busyStep !== null && busyStep !== step}
                onUpload={(file) => void upload(step, file)}
                onDeleteRequest={() => setPendingDelete(step)}
              />
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Удалить ${SLOT_META[pendingDelete].title.toLowerCase()}?` : ""}
        body="После удаления бот снова будет показывать текст-заглушку, пока не загрузишь новое."
        onCancel={() => setPendingDelete(null)}
        onConfirm={performDelete}
      />
    </section>
  );
}

function SlotCard({
  jwt,
  slot,
  busy,
  compressing,
  uploading,
  disabledByOther,
  onUpload,
  onDeleteRequest,
}: {
  jwt: string;
  slot: Slot;
  busy: boolean;
  compressing: CompressProgress | null;
  uploading: { loaded: number; total: number } | null;
  disabledByOther: boolean;
  onUpload: (file: File) => void;
  onDeleteRequest: () => void;
}) {
  const meta = SLOT_META[slot.step];
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  // iOS WebKit (TG Mini App webview) is flaky with <video> + 302 redirect
  // to a cross-origin signed URL — the range request after the redirect
  // can fail silently and leave the player stuck on the play-button
  // placeholder. Fetch the signed Supabase URL up-front and point
  // <video src> at it directly.
  // Construct the public URL directly from slot.storage_path. The bucket
  // is public, getPublicUrl is just URL string concatenation — no extra
  // fetch needed. This makes the URL a pure derivation of the slot prop:
  // when slots refetches after Replace, the new storage_path immediately
  // produces a new URL, no stale-state class possible.
  const signedSrc = slot.present ? publicUrlFor(slot.storage_path) : null;

  function pick() {
    setLocalError(null);
    inputRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    if (!VIDEO_MIMES.has(f.type)) {
      setLocalError("только mp4 / mov / webm");
      return;
    }
    if (f.size <= 0) {
      setLocalError("пустой файл");
      return;
    }
    // Big files go through the in-browser compressor. We still reject if
    // they're WAY beyond what we can plausibly compress (~4 GB) — pure
    // safety so we don't hand ffmpeg.wasm an unworkable input.
    if (f.size > 4 * 1024 * 1024 * 1024) {
      setLocalError(`файл больше ${formatBytes(4 * 1024 * 1024 * 1024)}`);
      return;
    }
    onUpload(f);
  }

  const pct = compressing ? Math.round(compressing.ratio * 100) : 0;

  return (
    <div className="rounded-xl bg-tg-bg-secondary p-3 space-y-2">
      <div>
        <div className="text-sm font-semibold tracking-tight">{meta.title}</div>
        <div className="text-xs text-tg-text-hint">{meta.when}</div>
      </div>

      {slot.present && signedSrc ? (
        <>
          <video
            // Key forces React to recreate the <video> element when the
            // underlying file changes — otherwise iOS WebKit can latch
            // onto the previous src's range-request state.
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
            className="block w-full max-w-sm max-h-48 rounded-lg bg-black"
          />
          {videoError && (
            <div className="text-[11px] text-tg-text-destructive">
              видео не загружается: {videoError}
            </div>
          )}
          <div className="text-[11px] text-tg-text-hint truncate flex items-center gap-2">
            <span className="truncate" title={slot.original_filename}>
              {slot.original_filename} · {formatBytes(slot.bytes)}
            </span>
            <a
              href={signedSrc}
              target="_blank"
              rel="noreferrer"
              className="text-tg-text-link shrink-0"
            >
              открыть в браузере
            </a>
          </div>
        </>
      ) : (
        <div className="text-xs text-tg-text-hint italic">
          Не загружено — пока используется текст-заглушка.
        </div>
      )}

      {compressing && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-xs text-tg-text">
            <span>Сжимаем видео ({compressing.preset})…</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-tg-text-accent transition-[width] duration-150 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {uploading && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-xs text-tg-text">
            <span>
              Загружаем в хранилище… {formatBytes(uploading.loaded)} / {formatBytes(uploading.total)}
            </span>
            <span className="tabular-nums">
              {Math.round((uploading.loaded / Math.max(1, uploading.total)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-tg-text-accent transition-[width] duration-150 ease-linear"
              style={{
                width: `${Math.min(100, Math.round((uploading.loaded / Math.max(1, uploading.total)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {localError && <div className="text-xs text-tg-text-destructive">{localError}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={pick}
          disabled={busy || disabledByOther}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
        >
          {busy ? <Spinner size={12} /> : slot.present ? "Заменить" : "Загрузить"}
        </button>
        {slot.present && (
          <button
            type="button"
            onClick={onDeleteRequest}
            disabled={busy || disabledByOther}
            className="inline-flex items-center h-9 px-4 rounded-full bg-tg-bg-section text-tg-text-destructive text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
          >
            Удалить
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onFile}
        className="hidden"
      />
    </div>
  );
}
