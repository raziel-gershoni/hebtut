"use client";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";

interface TagDictEntry {
  id: number;
  name: string;
  slug: string;
}

/**
 * Tutor-facing "card" for a student. Opened from the chat header. Today
 * shows the student's name + tag chips wired to the admin-managed
 * dictionary in /api/admin/media/tags. Tapping a chip toggles the
 * assignment (saves after a debounce).
 *
 * Auth: admin OR the teacher linked to this student. Same gate as the
 * thread itself.
 */
export function StudentCardDialog({
  open,
  jwt,
  studentId,
  studentLabel,
  onClose,
}: {
  open: boolean;
  jwt: string;
  studentId: number;
  studentLabel: string;
  onClose: () => void;
}) {
  const [dict, setDict] = useState<TagDictEntry[] | null>(null);
  const [assigned, setAssigned] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = { Authorization: `Bearer ${jwt}` };
    try {
      const [dictRes, assignedRes] = await Promise.all([
        fetch("/api/admin/media/tags", { cache: "no-store", headers }),
        fetch(`/api/users/${studentId}/tags`, { cache: "no-store", headers }),
      ]);
      if (!dictRes.ok || !assignedRes.ok) {
        setError(ru.inbox.studentCard.loadError);
        return;
      }
      const dictBody = (await dictRes.json()) as { tags: TagDictEntry[] };
      const assignedBody = (await assignedRes.json()) as { tags: TagDictEntry[] };
      setDict(dictBody.tags);
      setAssigned(new Set(assignedBody.tags.map((t) => t.id)));
    } catch {
      setError(ru.inbox.studentCard.loadError);
    }
  }, [jwt, studentId]);

  useEffect(() => {
    if (!open) return;
    setDict(null);
    setAssigned(null);
    void load();
  }, [open, load]);

  async function toggle(tagId: number) {
    if (busy || assigned === null) return;
    const next = new Set(assigned);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setAssigned(next);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/users/${studentId}/tags`, {
        method: "PUT",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tagIds: Array.from(next) }),
      });
      if (!r.ok) {
        setError(ru.inbox.studentCard.saveError);
        // Roll back the optimistic toggle on failure.
        setAssigned(assigned);
      }
    } catch {
      setError(ru.inbox.studentCard.saveError);
      setAssigned(assigned);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
        <h2 className="font-semibold tracking-tight mb-1">
          {ru.inbox.studentCard.dialogTitle}
        </h2>
        <div className="text-sm text-tg-text-subtitle mb-4 truncate">{studentLabel}</div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          <h3 className="text-xs uppercase tracking-wider text-tg-text-hint mb-2">
            {ru.inbox.studentCard.tagsHeading}
          </h3>
          {dict === null || assigned === null ? (
            <div className="py-6 text-center"><Spinner /></div>
          ) : dict.length === 0 ? (
            <div className="text-sm text-tg-text-hint italic py-4">
              {ru.inbox.studentCard.tagsEmptyDictionary}
            </div>
          ) : (
            <>
              <p className="text-xs text-tg-text-hint mb-3 leading-snug">
                {ru.inbox.studentCard.tagsHint}
              </p>
              <div className="flex flex-wrap gap-2">
                {dict.map((tag) => {
                  const on = assigned.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void toggle(tag.id)}
                      className={`inline-flex items-center px-3 h-8 rounded-full text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${
                        on
                          ? "bg-tg-button text-tg-button-text"
                          : "bg-tg-bg-secondary text-tg-text"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-tg-text-destructive">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95"
          >
            {ru.inbox.studentCard.closeButton}
          </button>
        </div>
      </div>
    </div>
  );
}
