"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { bgFromHandle } from "@/lib/handle";

interface Student {
  id: number;
  handle: string;
  emoji: string;
}

interface StudentPickerProps {
  jwt: string;
  onClose: () => void;
}

/**
 * Modal lister of the current teacher's linked students. Tap a row to seed a
 * brand-new outbound prompt (`/api/teacher/initiate`), which sends a
 * "📩 Сообщение для X" message to the teacher's TG and closes the Mini App so
 * the prompt is visible. Conflict (another teacher holds the claim) shows
 * inline and keeps the picker open.
 */
export function StudentPicker({ jwt, onClose }: StudentPickerProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/teacher/students", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { students: Student[] };
      setStudents(d.students);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);


  async function pick(studentId: number) {
    setBusyId(studentId);
    setError(null);
    try {
      const r = await fetch("/api/teacher/initiate", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: true; error?: string };
      if (r.ok && d.ok) {
        // Mirror the per-message reply flow — close so the prompt is visible.
        window.Telegram?.WebApp?.close?.();
        return;
      }
      setError(
        d.error === "taken-by-other"
          ? "Другой тренер сейчас работает с этим учеником"
          : d.error === "not-allowed"
            ? "Связь с этим учеником утрачена"
            : "Не удалось — попробуй ещё раз",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm max-h-[80vh] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up flex flex-col"
      >
        <header className="px-5 py-3 border-b border-tg-text-hint/15 flex items-center justify-between shrink-0">
          <h2 className="font-semibold tracking-tight">Кому написать?</h2>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-tg-text-hint hover:text-tg-text transition-colors"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto p-2 flex-1">
          {!loaded && (
            <ul className="space-y-1.5 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="h-12 rounded-xl bg-tg-bg-secondary" />
              ))}
            </ul>
          )}

          {loaded && students.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-tg-text-hint">
              За тобой пока не закреплены ученики.
            </div>
          )}

          {loaded && students.length > 0 && (
            <ul className="space-y-1">
              {students.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void pick(s.id)}
                    className="w-full flex items-center gap-3 p-2 rounded-xl active:bg-tg-bg-secondary transition-colors disabled:opacity-50"
                  >
                    <Avatar
                      size={36}
                      name={s.handle}
                      emoji={s.emoji}
                      bgClass={bgFromHandle(s.handle)}
                    />
                    <span className="flex-1 min-w-0 truncate text-left">
                      {s.handle}
                    </span>
                    {busyId === s.id && <Spinner size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="px-5 py-2.5 text-xs text-tg-text-destructive border-t border-tg-text-hint/15 shrink-0">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
