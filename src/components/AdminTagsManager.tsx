"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { ru } from "@/lib/i18n";

interface TagRow {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  usage_count: number;
}

interface Props {
  jwt: string;
}

/**
 * Admin-only catalog editor for media library tags. Hidden completely for
 * non-admins — render gating happens at the parent level.
 */
export function AdminTagsManager({ jwt }: Props) {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/media/tags", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setTags([]);
      return;
    }
    const d = (await r.json()) as { tags: TagRow[] };
    setTags(d.tags);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/admin/media/tags", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: trimmed }),
    });
    setBusy(false);
    if (r.status === 409) {
      const d = (await r.json().catch(() => ({}))) as { tag?: { name?: string } };
      setError(ru.admin.tags.alreadyExists(d.tag?.name ?? trimmed));
      return;
    }
    if (!r.ok) {
      setError(ru.admin.tags.addFailed);
      return;
    }
    setName("");
    await load();
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    const r = await fetch(`/api/admin/media/tags/${id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError(ru.admin.tags.deleteFailed);
      return;
    }
    await load();
  }

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{ru.admin.tags.sectionTitle}</h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={ru.admin.tags.newTagPlaceholder}
          className="flex-1 h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !name.trim()}
          aria-busy={busy}
          className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[5rem]"
        >
          {busy ? <Spinner /> : ru.admin.tags.addButton}
        </button>
      </div>
      {error && <div className="text-xs text-tg-text-destructive">{error}</div>}

      {tags === null ? (
        <div className="py-4 text-center"><Spinner /></div>
      ) : tags.length === 0 ? (
        <div className="text-xs text-tg-text-hint">{ru.admin.tags.empty}</div>
      ) : (
        <ul className="divide-y divide-tg-text-hint/10">
          {tags.map((t) => (
            <li
              key={t.id}
              className="py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-tg-text truncate">{t.name}</div>
                <div className="text-[11px] text-tg-text-hint">
                  {t.usage_count > 0 ? ru.admin.tags.usageCount(t.usage_count) : ru.admin.tags.notUsed}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(t)}
                className="text-xs text-tg-text-destructive font-medium"
              >
                {ru.admin.tags.deleteButton}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? ru.admin.tags.deleteConfirmTitle(pendingDelete.name) : ""}
        body={
          pendingDelete && pendingDelete.usage_count > 0
            ? ru.admin.tags.deleteConfirmBody(pendingDelete.usage_count)
            : ru.admin.tags.deleteConfirmBodyEmpty
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={performDelete}
      />
    </section>
  );
}
