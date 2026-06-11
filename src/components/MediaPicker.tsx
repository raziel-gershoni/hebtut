"use client";

import { ru } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { MediaPreview, type MediaLibraryListItem } from "./MediaPreview";
import { TagPicker, type TagOption } from "./TagPicker";
import { EditMediaItemDialog } from "./EditMediaItemDialog";
import {
  ALLOWED_MIME_TYPES,
  MAX_BYTES,
  MAX_TITLE_LEN,
  MIME_TO_KIND,
  deriveTitleFromFilename,
  formatBytes,
} from "@/lib/media";
import {
  COMPRESS_TRIGGER_BYTES,
  LIBRARY_MAX_DURATION_SEC,
  formatErr,
  isCompressibleVideo,
  isVideoPlayableByBrowser,
  prepareVideoForUpload,
  probeVideoMetadata,
  type CompressProgress,
} from "@/lib/video-compress";
import { tusUpload } from "@/lib/direct-upload";
import { extractFfmpegLogTail, reportClientMediaError } from "@/lib/diag";

interface Props {
  open: boolean;
  jwt: string;
  /**
   * When null, the picker runs in "browse + upload + edit + delete" mode
   * — no Send button, no selection submit. Used by the admin panel.
   */
  studentId: number | null;
  onClose: () => void;
  /** Only invoked after a successful send. Omitted in browse mode. */
  onSent?: () => Promise<void>;
}

type KindFilter = "all" | "photo" | "video" | "audio";

const KIND_LABELS: Record<KindFilter, string> = {
  all: ru.inbox.mediaPicker.kindAll,
  photo: ru.inbox.mediaPicker.kindPhoto,
  video: ru.inbox.mediaPicker.kindVideo,
  audio: ru.inbox.mediaPicker.kindAudio,
};

const ACCEPT = ALLOWED_MIME_TYPES.join(",");

export function MediaPicker({ open, jwt, studentId, onClose, onSent }: Props) {
  const [items, setItems] = useState<MediaLibraryListItem[] | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [tagFilterSlugs, setTagFilterSlugs] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadStaging, setUploadStaging] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadTagIds, setUploadTagIds] = useState<number[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState<CompressProgress | null>(null);
  const [uploading, setUploading] = useState<{ loaded: number; total: number } | null>(null);

  const [editing, setEditing] = useState<MediaLibraryListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryListItem | null>(null);
  const [kebabFor, setKebabFor] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/media", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError(ru.inbox.mediaPicker.loadError);
      return;
    }
    const d = (await r.json()) as { items: MediaLibraryListItem[]; can_upload: boolean };
    setItems(d.items);
    setCanUpload(d.can_upload);
  }, [jwt]);

  const loadTags = useCallback(async () => {
    const r = await fetch("/api/admin/media/tags", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as { tags: TagOption[] };
    setTags(d.tags);
  }, [jwt]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setSelectedId(null);
    setKindFilter("all");
    setTagFilterSlugs([]);
    setSearch("");
    setError(null);
    setUploadStaging(null);
    setEditing(null);
    setPendingDelete(null);
    setKebabFor(null);
    void load();
    void loadTags();
  }, [open, load, loadTags]);

  const visible = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (tagFilterSlugs.length > 0) {
        const present = new Set(it.tags.map((t) => t.slug));
        for (const s of tagFilterSlugs) if (!present.has(s)) return false;
      }
      if (q) {
        const hay = `${it.title ?? ""} ${it.description ?? ""} ${it.original_filename}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, kindFilter, tagFilterSlugs, search]);

  function toggleTagFilter(slug: string) {
    setTagFilterSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  function pickFile() {
    setUploadError(null);
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    if (!ALLOWED_MIME_TYPES.includes(f.type)) {
      setUploadError(ru.inbox.mediaPicker.unsupportedFormat);
      return;
    }
    if (f.size <= 0) {
      setUploadError(ru.inbox.mediaPicker.emptyFile);
      return;
    }
    const kind = MIME_TO_KIND[f.type] ?? null;
    // Videos over the limit get compressed at upload time. Photos and
    // audio still hard-fail because there's no compression path for them.
    if (f.size > MAX_BYTES && !isCompressibleVideo(f.type, kind)) {
      setUploadError(ru.inbox.mediaPicker.fileTooLarge(formatBytes(MAX_BYTES)));
      return;
    }
    setUploadStaging(f);
    setUploadTitle(deriveTitleFromFilename(f.name));
    setUploadDescription("");
    setUploadTagIds([]);
  }

  async function performUpload() {
    if (!uploadStaging) return;
    setUploadBusy(true);
    setUploadError(null);

    let fileToSend: File = uploadStaging;
    const kind = MIME_TO_KIND[uploadStaging.type] ?? null;
    const compressible = isCompressibleVideo(uploadStaging.type, kind);

    if (compressible) {
      // Probe first — same gate the onboarding pipeline uses. Gives us
      // width/height/duration to plan the encode AND tells us if the
      // file is at all sane. Without this we'd skip compression for
      // files that <video> can load metadata for but ffmpeg can't
      // actually decode (subtle H.264 incompatibilities), which is the
      // root cause of the iOS "compression undefined" failure.
      const meta = await probeVideoMetadata(uploadStaging);
      const tooBig = uploadStaging.size > COMPRESS_TRIGGER_BYTES;
      const probeOk = meta != null;
      const tooLong = meta != null && meta.duration > LIBRARY_MAX_DURATION_SEC;

      // No path forward: probe failed AND we can't fall back to uploading
      // the original (too big). Surface a clear error up front.
      if (!probeOk && uploadStaging.size > MAX_BYTES) {
        setUploadBusy(false);
        void reportClientMediaError(
          "probe",
          new Error("probe failed; file too large to upload raw"),
          {
            size_bytes: uploadStaging.size,
            mime: uploadStaging.type,
            name: uploadStaging.name,
          },
          jwt,
        );
        setUploadError(ru.inbox.mediaPicker.videoUnreadable);
        return;
      }
      if (tooLong) {
        setUploadBusy(false);
        void reportClientMediaError(
          "probe",
          new Error(`source duration exceeds ${LIBRARY_MAX_DURATION_SEC}s`),
          {
            size_bytes: uploadStaging.size,
            mime: uploadStaging.type,
            name: uploadStaging.name,
            duration_sec: meta?.duration ?? null,
          },
          jwt,
        );
        setUploadError(
          ru.inbox.mediaPicker.videoTooLong(LIBRARY_MAX_DURATION_SEC),
        );
        return;
      }

      // Compress when: (a) too big to fit raw, OR (b) probe succeeded but
      // the browser can't play it (forces ffmpeg's hand to re-mux to
      // something TG can accept).
      const playable =
        probeOk && !tooBig ? await isVideoPlayableByBrowser(uploadStaging) : true;

      if (tooBig || !playable) {
        setCompressing({ ratio: 0, preset: "720p" });
        try {
          fileToSend = await prepareVideoForUpload(uploadStaging, {
            libraryMode: true,
            maxDurationSec: LIBRARY_MAX_DURATION_SEC,
            meta: meta ?? undefined,
            onProgress: (p) => setCompressing(p),
          });
        } catch (e) {
          setCompressing(null);
          // ffmpeg.wasm fails on some iOS WebView builds. When the
          // source file is already under TG's hard limit, just upload
          // it as-is — TG will decode whatever it can. Only block when
          // the file truly can't be sent.
          if (uploadStaging.size <= MAX_BYTES) {
            console.warn(
              "[media-upload] compression failed, uploading original",
              e,
            );
            fileToSend = uploadStaging;
          } else {
            setUploadBusy(false);
            void reportClientMediaError(
              "compress",
              e,
              {
                size_bytes: uploadStaging.size,
                mime: uploadStaging.type,
                name: uploadStaging.name,
                ffmpeg_log_tail: extractFfmpegLogTail(e),
              },
              jwt,
            );
            setUploadError(ru.inbox.mediaPicker.compressError(formatErr(e)));
            return;
          }
        }
        setCompressing(null);
        if (fileToSend.size > MAX_BYTES) {
          setUploadBusy(false);
          void reportClientMediaError(
            "compress",
            new Error(`compressed output ${fileToSend.size}B still over cap`),
            {
              size_bytes: fileToSend.size,
              original_size_bytes: uploadStaging.size,
              mime: fileToSend.type,
              name: fileToSend.name,
            },
            jwt,
          );
          setUploadError(
            ru.inbox.mediaPicker.stillTooLarge(formatBytes(fileToSend.size)),
          );
          return;
        }
      }
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
      const urlRes = await fetch("/api/admin/media/upload-url", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mime_type: fileToSend.type }),
      });
      if (!urlRes.ok) {
        setUploadBusy(false);
        void reportClientMediaError(
          "upload-presign",
          new Error(`presign HTTP ${urlRes.status}`),
          {
            size_bytes: fileToSend.size,
            mime: fileToSend.type,
            name: fileToSend.name,
            http_status: urlRes.status,
          },
          jwt,
        );
        setUploadError(
          urlRes.status === 403
            ? ru.inbox.mediaPicker.uploadsDisabled
            : urlRes.status === 415
              ? ru.inbox.mediaPicker.unsupportedMime
              : ru.inbox.mediaPicker.presignFailed(urlRes.status),
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
      setUploadBusy(false);
      setUploading(null);
      void reportClientMediaError(
        "upload-tus",
        e,
        {
          size_bytes: fileToSend.size,
          mime: fileToSend.type,
          name: fileToSend.name,
          storage_path: path,
        },
        jwt,
      );
      setUploadError(ru.inbox.mediaPicker.storageUploadFailed((e as Error).message));
      return;
    }
    setUploading(null);
    const signed = { bucket, path };

    // Probe the final video so TG's sendVideo gets explicit width/height/
    // duration. Without those TG defaults the preview to 320×320 (squished
    // square) and caches that bad rendering in the resulting file_id.
    let videoMeta: { width: number; height: number; duration: number } | null = null;
    if (kind === "video") {
      videoMeta = await probeVideoMetadata(fileToSend);
    }

    const r = await fetch("/api/admin/media", {
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
        title: uploadTitle.trim() || null,
        description: uploadDescription.trim() || null,
        tag_ids: uploadTagIds,
        duration_seconds: videoMeta ? Math.max(1, Math.round(videoMeta.duration)) : null,
        width: videoMeta ? videoMeta.width : null,
        height: videoMeta ? videoMeta.height : null,
      }),
    });
    setUploadBusy(false);
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
        },
        jwt,
      );
      setUploadError(
        body.startsWith("uploaded object missing")
          ? ru.inbox.mediaPicker.storageMissed
          : ru.inbox.mediaPicker.registerFailed(body || r.statusText),
      );
      return;
    }
    const { id } = (await r.json()) as { id: number };
    setUploadStaging(null);
    await load();
    setSelectedId(id);
  }

  async function performSend() {
    if (!selectedId) return;
    if (studentId == null) return;
    setSendBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/media/${selectedId}/send`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ student_id: studentId }),
    });
    setSendBusy(false);
    if (!r.ok) {
      void reportClientMediaError(
        "send",
        new Error(`send HTTP ${r.status}`),
        {
          library_id: selectedId,
          student_id: studentId,
          http_status: r.status,
        },
        jwt,
      );
      setError(r.status === 403 ? ru.inbox.mediaPicker.sendNoAccess : ru.inbox.mediaPicker.sendError);
      return;
    }
    await onSent?.();
    onClose();
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const r = await fetch(`/api/admin/media/${id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    setPendingDelete(null);
    if (!r.ok) {
      setError(r.status === 403 ? ru.inbox.mediaPicker.deleteForbidden : ru.inbox.mediaPicker.deleteError);
      return;
    }
    if (selectedId === id) setSelectedId(null);
    await load();
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
        <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up flex flex-col max-h-[92vh]">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold tracking-tight">Медиа-библиотека</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={ru.inbox.mediaPicker.closeAriaLabel}
              className="w-9 h-9 rounded-full bg-tg-bg-secondary text-tg-text inline-flex items-center justify-center active:scale-95"
            >
              ×
            </button>
          </div>

          <div className="px-5 space-y-2 pb-3 border-b border-tg-text-hint/10">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ru.inbox.mediaPicker.searchPlaceholder}
              className="w-full h-9 px-3 rounded-full bg-tg-bg-secondary text-xs text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
            />
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar">
              {(Object.keys(KIND_LABELS) as KindFilter[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`shrink-0 inline-flex items-center px-3 h-7 rounded-full text-xs font-medium transition-all active:scale-95 ${
                    kindFilter === k
                      ? "bg-tg-button text-tg-button-text"
                      : "bg-tg-bg-secondary text-tg-text-hint"
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar items-center">
                {tags.map((t) => {
                  const on = tagFilterSlugs.includes(t.slug);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTagFilter(t.slug)}
                      className={`shrink-0 inline-flex items-center px-3 h-7 rounded-full text-xs font-medium transition-all active:scale-95 ${
                        on
                          ? "bg-tg-text-accent text-white"
                          : "bg-tg-bg-secondary text-tg-text-hint"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
                {tagFilterSlugs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTagFilterSlugs([])}
                    className="shrink-0 text-xs text-tg-text-link px-2"
                  >
                    Очистить
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {items === null ? (
              <div className="py-10 flex justify-center"><Spinner /></div>
            ) : visible.length === 0 ? (
              <div className="py-10 text-center text-sm text-tg-text-hint">
                {items.length === 0 ? ru.inbox.mediaPicker.emptyLibrary : ru.inbox.mediaPicker.nothingFound}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {visible.map((it) => (
                  <MediaPreview
                    key={it.id}
                    item={it}
                    jwt={jwt}
                    selected={selectedId === it.id}
                    onClick={() => setSelectedId(it.id)}
                    onKebab={() => setKebabFor(it.id)}
                  />
                ))}
              </div>
            )}
            {kebabFor != null && items && (
              <KebabSheet
                item={items.find((x) => x.id === kebabFor)!}
                onClose={() => setKebabFor(null)}
                onEdit={() => {
                  const it = items.find((x) => x.id === kebabFor)!;
                  setKebabFor(null);
                  setEditing(it);
                }}
                onDelete={() => {
                  const it = items.find((x) => x.id === kebabFor)!;
                  setKebabFor(null);
                  setPendingDelete(it);
                }}
              />
            )}
          </div>

          {error && (
            <div className="px-5 pb-2 text-xs text-tg-text-destructive">{error}</div>
          )}

          <div className="px-5 pt-3 pb-5 border-t border-tg-text-hint/10 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {canUpload ? (
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={uploadBusy || sendBusy}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
                >
                  + Загрузить
                </button>
              ) : (
                <span className="text-xs text-tg-text-hint">
                  Загрузка медиа отключена администратором
                </span>
              )}
            </div>
            {studentId != null && (
              <button
                type="button"
                disabled={selectedId === null || sendBusy || uploadBusy}
                onClick={() => void performSend()}
                aria-busy={sendBusy}
                className="h-10 px-5 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[7rem]"
              >
                {sendBusy ? <Spinner /> : ru.inbox.mediaPicker.sendButton}
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={onFileChosen}
            className="hidden"
          />
        </div>
      </div>

      {uploadStaging && (
        <UploadConfirmDialog
          file={uploadStaging}
          title={uploadTitle}
          description={uploadDescription}
          tagIds={uploadTagIds}
          busy={uploadBusy}
          compressing={compressing}
          uploading={uploading}
          error={uploadError}
          jwt={jwt}
          onTitleChange={setUploadTitle}
          onDescriptionChange={setUploadDescription}
          onTagsChange={setUploadTagIds}
          onCancel={() => setUploadStaging(null)}
          onConfirm={() => void performUpload()}
        />
      )}

      {editing && (
        <EditMediaItemDialog
          open={true}
          jwt={jwt}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            await loadTags();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={ru.inbox.mediaPicker.deleteConfirmTitle}
        body={
          pendingDelete ? (
            <>
              Файл «{pendingDelete.title?.trim() || pendingDelete.original_filename}» будет удалён
              из библиотеки. Уже отправленные пользователям сообщения сохранятся.
            </>
          ) : null
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={performDelete}
      />
    </>
  );
}

function UploadConfirmDialog({
  file,
  title,
  description,
  tagIds,
  busy,
  compressing,
  uploading,
  error,
  jwt,
  onTitleChange,
  onDescriptionChange,
  onTagsChange,
  onCancel,
  onConfirm,
}: {
  file: File;
  title: string;
  description: string;
  tagIds: number[];
  busy: boolean;
  compressing: CompressProgress | null;
  uploading: { loaded: number; total: number } | null;
  error: string | null;
  jwt: string;
  onTitleChange: (s: string) => void;
  onDescriptionChange: (s: string) => void;
  onTagsChange: (next: number[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const willCompress = file.size > COMPRESS_TRIGGER_BYTES;
  const pct = compressing ? Math.round(compressing.ratio * 100) : 0;
  const uploadPct = uploading
    ? Math.min(100, Math.round((uploading.loaded / Math.max(1, uploading.total)) * 100))
    : 0;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-3 max-h-[92vh] overflow-y-auto">
        <h2 className="font-semibold tracking-tight">Загрузить в библиотеку</h2>
        <div className="rounded-xl bg-tg-bg-secondary p-3 text-xs leading-snug">
          <div className="text-tg-text truncate" title={file.name}>{file.name}</div>
          <div className="text-tg-text-hint mt-0.5">{file.type} · {formatBytes(file.size)}</div>
          {willCompress && !compressing && (
            <div className="text-tg-text-hint mt-1">
              Файл больше {formatBytes(COMPRESS_TRIGGER_BYTES)} — перед загрузкой сожмём в браузере.
            </div>
          )}
          {compressing && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-tg-text">
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
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-tg-text">
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
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
            Название
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            maxLength={MAX_TITLE_LEN}
            className="w-full h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
            Описание
          </span>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={ru.inbox.mediaItem.descriptionPlaceholder}
            className="w-full px-3 py-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40 resize-y"
          />
        </label>
        <div>
          <div className="text-xs uppercase tracking-wider text-tg-text-hint mb-1.5">Теги</div>
          <TagPicker jwt={jwt} valueIds={tagIds} onChange={onTagsChange} disabled={busy} />
        </div>
        {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            aria-busy={busy}
            className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
          >
            {busy ? <Spinner /> : ru.inbox.mediaPicker.uploadButton}
          </button>
        </div>
      </div>
    </div>
  );
}

function KebabSheet({
  item,
  onClose,
  onEdit,
  onDelete,
}: {
  item: MediaLibraryListItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[55] flex items-end justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-tg-bg-section rounded-t-2xl shadow-2xl animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 text-xs text-tg-text-hint border-b border-tg-text-hint/10 truncate">
          {item.title?.trim() || item.original_filename}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="block w-full text-left px-5 py-3 text-sm text-tg-text active:bg-tg-bg-secondary"
        >
          Изменить
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="block w-full text-left px-5 py-3 text-sm text-tg-text-destructive active:bg-tg-bg-secondary"
        >
          Удалить
        </button>
        <button
          type="button"
          onClick={onClose}
          className="block w-full text-center px-5 py-3 text-sm text-tg-text-hint active:bg-tg-bg-secondary border-t border-tg-text-hint/10"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

