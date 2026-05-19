"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { MediaPreview, type MediaLibraryListItem } from "./MediaPreview";
import { TagPicker, type TagOption } from "./TagPicker";
import { EditMediaItemDialog } from "./EditMediaItemDialog";
import { ALLOWED_MIME_TYPES, MAX_BYTES, formatBytes } from "@/lib/media";

interface Props {
  open: boolean;
  jwt: string;
  studentId: number;
  onClose: () => void;
  onSent: () => Promise<void>;
}

type KindFilter = "all" | "photo" | "video" | "audio";

const KIND_LABELS: Record<KindFilter, string> = {
  all: "Все",
  photo: "Фото",
  video: "Видео",
  audio: "Аудио",
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
      setError("Не удалось загрузить библиотеку");
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
      setUploadError("Неподдерживаемый формат файла");
      return;
    }
    if (f.size <= 0 || f.size > MAX_BYTES) {
      setUploadError(`Файл больше ${formatBytes(MAX_BYTES)}`);
      return;
    }
    setUploadStaging(f);
    setUploadTitle(stripExt(f.name));
    setUploadDescription("");
    setUploadTagIds([]);
  }

  async function performUpload() {
    if (!uploadStaging) return;
    setUploadBusy(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("file", uploadStaging);
    fd.append("title", uploadTitle.trim());
    fd.append("description", uploadDescription.trim());
    fd.append("tag_ids", JSON.stringify(uploadTagIds));
    const r = await fetch("/api/admin/media", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
      body: fd,
    });
    setUploadBusy(false);
    if (!r.ok) {
      const reason = r.status === 403 ? "загрузка отключена администратором" : "не удалось загрузить";
      setUploadError(reason);
      return;
    }
    const { id } = (await r.json()) as { id: number };
    setUploadStaging(null);
    await load();
    setSelectedId(id);
  }

  async function performSend() {
    if (!selectedId) return;
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
      setError(r.status === 403 ? "нет доступа к ученику" : "не удалось отправить");
      return;
    }
    await onSent();
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
      setError(r.status === 403 ? "только загрузивший или админ" : "не удалось удалить");
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
              aria-label="Закрыть"
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
              placeholder="Поиск по названию или файлу"
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
                {items.length === 0 ? "Библиотека пуста" : "Ничего не найдено"}
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
            <button
              type="button"
              disabled={selectedId === null || sendBusy || uploadBusy}
              onClick={() => void performSend()}
              aria-busy={sendBusy}
              className="h-10 px-5 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[7rem]"
            >
              {sendBusy ? <Spinner /> : "Отправить"}
            </button>
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
        title="Удалить материал?"
        body={
          pendingDelete ? (
            <>
              Файл «{pendingDelete.title?.trim() || pendingDelete.original_filename}» будет удалён
              из библиотеки. Уже отправленные ученикам сообщения сохранятся.
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
  error: string | null;
  jwt: string;
  onTitleChange: (s: string) => void;
  onDescriptionChange: (s: string) => void;
  onTagsChange: (next: number[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-3 max-h-[92vh] overflow-y-auto">
        <h2 className="font-semibold tracking-tight">Загрузить в библиотеку</h2>
        <div className="rounded-xl bg-tg-bg-secondary p-3 text-xs leading-snug">
          <div className="text-tg-text truncate" title={file.name}>{file.name}</div>
          <div className="text-tg-text-hint mt-0.5">{file.type} · {formatBytes(file.size)}</div>
        </div>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
            Название
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            maxLength={80}
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
            placeholder="Короткое описание для тренеров"
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
            {busy ? <Spinner /> : "Загрузить"}
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

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
