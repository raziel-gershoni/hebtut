"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { MAX_BYTES, formatBytes } from "@/lib/media";
import {
  COMPRESS_TARGET_BYTES,
  prepareVideoForUpload,
  type CompressProgress,
} from "@/lib/video-compress";
import type { OnboardingVideoStep } from "@/types/database";

type Slot =
  | { step: OnboardingVideoStep; present: false }
  | {
      step: OnboardingVideoStep;
      present: true;
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
    if (file.size > COMPRESS_TARGET_BYTES) {
      setCompressing({ ratio: 0, preset: "720p" });
      try {
        fileToSend = await prepareVideoForUpload(file, {
          onProgress: (p) => setCompressing(p),
        });
      } catch (e) {
        setBusyStep(null);
        setCompressing(null);
        setError(`не удалось сжать видео: ${(e as Error).message}`);
        return;
      }
      setCompressing(null);
    }
    const fd = new FormData();
    fd.append("file", fileToSend);
    const r = await fetch(`/api/admin/onboarding-videos/${step}`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
      body: fd,
    });
    setBusyStep(null);
    if (!r.ok) {
      setError(
        r.status === 413
          ? `файл больше ${formatBytes(MAX_BYTES)} даже после сжатия`
          : r.status === 415
            ? "только mp4 / mov / webm"
            : "не удалось загрузить",
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
        Если слот пустой — бот шлёт текст-заглушку, как сейчас. Заменишь
        видео — следующая отправка снова закэширует TG-file_id.
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
  disabledByOther,
  onUpload,
  onDeleteRequest,
}: {
  jwt: string;
  slot: Slot;
  busy: boolean;
  compressing: CompressProgress | null;
  disabledByOther: boolean;
  onUpload: (file: File) => void;
  onDeleteRequest: () => void;
}) {
  const meta = SLOT_META[slot.step];
  const inputRef = useRef<HTMLInputElement>(null);
  const previewSrc = `/api/admin/onboarding-videos/${slot.step}/preview?token=${encodeURIComponent(jwt)}`;
  const [localError, setLocalError] = useState<string | null>(null);

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

      {slot.present ? (
        <>
          <video
            src={previewSrc}
            controls
            preload="metadata"
            className="block w-full max-w-sm max-h-48 rounded-lg bg-black"
          />
          <div
            className="text-[11px] text-tg-text-hint truncate"
            title={slot.original_filename}
          >
            {slot.original_filename} · {formatBytes(slot.bytes)}
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
