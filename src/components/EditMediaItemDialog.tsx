"use client";
import { ru } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { TagPicker } from "./TagPicker";
import { previewUrl, type MediaLibraryListItem } from "./MediaPreview";
import { formatBytes, MAX_TITLE_LEN } from "@/lib/media";

interface Props {
  open: boolean;
  jwt: string;
  item: MediaLibraryListItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const TITLE_MAX = MAX_TITLE_LEN;
const DESC_MAX = 500;

export function EditMediaItemDialog({ open, jwt, item, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(item.title ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [tagIds, setTagIds] = useState<number[]>(item.tags.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(item.title ?? "");
      setDescription(item.description ?? "");
      setTagIds(item.tags.map((t) => t.id));
      setError(null);
    }
  }, [open, item]);

  if (!open) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim() || null,
      description: description.trim() || null,
      tag_ids: tagIds,
    };
    const r = await fetch(`/api/admin/media/${item.id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.status === 403 ? ru.inbox.mediaItem.editForbidden : ru.inbox.mediaItem.editError);
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold tracking-tight">Изменить материал</h2>

        <div className="flex gap-3 items-start rounded-xl bg-tg-bg-secondary p-3">
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-black/10 flex items-center justify-center shrink-0">
            {item.kind === "photo" ? (
              <img
                src={previewUrl(item.id, jwt)}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : item.kind === "video" ? (
              <video
                // Direct presigned R2 URL (not the 302 /preview) + #t=0.1 so iOS
                // paints the first frame instead of a black box.
                src={`${item.url}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl text-tg-text-hint" aria-hidden>♪</span>
            )}
          </div>
          <div className="min-w-0 text-xs leading-snug">
            <div className="text-tg-text-hint">Файл</div>
            <div className="text-tg-text truncate" title={item.original_filename}>
              {item.original_filename}
            </div>
            <div className="text-tg-text-hint mt-0.5">{formatBytes(item.bytes)}</div>
            {item.uploader_name && (
              <div className="text-tg-text-hint mt-0.5">{item.uploader_name}</div>
            )}
          </div>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
            Название
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder={item.original_filename}
            className="w-full h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
        </label>

        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
            Описание
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESC_MAX}
            rows={3}
            placeholder={ru.inbox.mediaItem.descriptionPlaceholder}
            className="w-full px-3 py-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40 resize-y"
          />
        </label>

        <div>
          <div className="text-xs uppercase tracking-wider text-tg-text-hint mb-1.5">
            Теги
          </div>
          <TagPicker jwt={jwt} valueIds={tagIds} onChange={setTagIds} disabled={busy} />
        </div>

        {error && <div className="text-xs text-tg-text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
          >
            {ru.common.cancel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            aria-busy={busy}
            className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
          >
            {busy ? <Spinner /> : ru.inbox.mediaItem.saveButton}
          </button>
        </div>
      </div>
    </div>
  );
}
