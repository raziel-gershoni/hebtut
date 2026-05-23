"use client";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";

interface Teacher {
  id: number;
  display_handle: string | null;
  display_emoji: string | null;
  name: string | null;
  preferred_name: string | null;
  role: "pending" | "student" | "teacher";
}

interface AdminUserPayload {
  id: number;
  role: "pending" | "student" | "teacher";
  display_handle: string | null;
  display_emoji: string | null;
  name: string | null;
  preferred_name: string | null;
}

/**
 * Inbox-level dialog for assigning one or more teachers to a student that
 * has no row in `student_teachers`. Loads the teacher roster from the
 * existing `/api/admin/users` endpoint and POSTs one link per selected
 * teacher to `/api/admin/links`.
 *
 * `onSaved` fires after every link request resolves — caller is expected
 * to refetch the inbox so the "без тренера" pill disappears.
 */
export function AssignTeacherDialog({
  open,
  jwt,
  studentId,
  studentLabel,
  onClose,
  onSaved,
}: {
  open: boolean;
  jwt: string;
  studentId: number;
  studentLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch("/api/admin/users", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError("не удалось загрузить тренеров");
      return;
    }
    const d = (await r.json()) as { users: AdminUserPayload[] };
    setTeachers(d.users.filter((u) => u.role === "teacher"));
  }, [jwt]);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setError(null);
    void load();
  }, [open, load]);

  if (!open) return null;

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // One POST per teacher — the existing endpoint takes a single pair,
      // and the volume here is always small (a few teachers max).
      const results = await Promise.all(
        Array.from(picked).map((teacherId) =>
          fetch("/api/admin/links", {
            method: "POST",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${jwt}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ studentId, teacherId }),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(`не удалось привязать ${failed.length}/${results.length}`);
        // Still call onSaved so the partial result reflects in the inbox.
      }
      onSaved();
    } catch {
      setError("сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
        <h2 className="font-semibold tracking-tight mb-1">Назначить тренера</h2>
        <div className="text-sm text-tg-text-subtitle mb-4">
          Ученик: <span className="font-medium">{studentLabel}</span>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {teachers === null ? (
            <div className="py-8 text-center"><Spinner /></div>
          ) : teachers.length === 0 ? (
            <div className="text-sm text-tg-text-hint italic py-4">
              В системе пока нет тренеров.
            </div>
          ) : (
            <ul className="space-y-1">
              {teachers.map((t) => {
                const isPicked = picked.has(t.id);
                const label =
                  t.preferred_name ??
                  t.name ??
                  t.display_handle ??
                  `teacher ${t.id}`;
                return (
                  <li key={t.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                        isPicked ? "bg-tg-button/15" : "active:bg-tg-bg-secondary/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() => toggle(t.id)}
                        className="w-4 h-4 accent-tg-button shrink-0"
                      />
                      <span className="truncate text-sm">{label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-tg-text-destructive">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
          >
            Закрыть
          </button>
          <button
            type="button"
            disabled={busy || picked.size === 0}
            onClick={() => void save()}
            aria-busy={busy}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[7rem]"
          >
            {busy ? <Spinner /> : `Назначить (${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
