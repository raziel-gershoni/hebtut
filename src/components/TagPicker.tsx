"use client";

import { useEffect, useMemo, useState } from "react";

export interface TagOption {
  id: number;
  name: string;
  slug: string;
}

interface Props {
  jwt: string;
  valueIds: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
  /** Reseeds the list (used by parent dialogs that mount-on-open). */
  refreshKey?: unknown;
}

export function TagPicker({ jwt, valueIds, onChange, disabled, refreshKey }: Props) {
  const [tags, setTags] = useState<TagOption[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch("/api/admin/media/tags", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        if (!cancelled) setTags([]);
        return;
      }
      const d = (await r.json()) as { tags: TagOption[] };
      if (!cancelled) setTags(d.tags);
    })();
    return () => {
      cancelled = true;
    };
  }, [jwt, refreshKey]);

  const visible = useMemo(() => {
    if (!tags) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, filter]);

  function toggle(id: number) {
    if (disabled) return;
    if (valueIds.includes(id)) onChange(valueIds.filter((x) => x !== id));
    else onChange([...valueIds, id]);
  }

  if (tags === null) {
    return <div className="text-xs text-tg-text-hint">Загрузка тегов…</div>;
  }
  if (tags.length === 0) {
    return (
      <div className="text-xs text-tg-text-hint">
        Тегов пока нет. Попроси админа добавить.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tags.length > 8 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Поиск тегов…"
          className="w-full h-8 px-3 rounded-full bg-tg-bg-secondary text-xs text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((t) => {
          const on = valueIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(t.id)}
              aria-pressed={on}
              className={`inline-flex items-center px-3 h-7 rounded-full text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${
                on
                  ? "bg-tg-button text-tg-button-text"
                  : "bg-tg-bg-secondary text-tg-text-hint"
              }`}
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
