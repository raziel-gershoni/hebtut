"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ru } from "@/lib/i18n";

interface WindowData {
  start: string | null;
  end: string | null;
  tz: string;
}

export default function ResponseWindowPage() {
  return (
    <AppShell title={ru.student.responseWindow.pageTitle} back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.student.responseWindow.studentsOnly}
            </div>
          );
        }
        return <Body jwt={jwt} />;
      }}
    </AppShell>
  );
}

function Body({ jwt }: { jwt: string }) {
  const [data, setData] = useState<WindowData | null>(null);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("21:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/response-window", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as WindowData;
    setData(d);
    if (d.start) setStart(d.start);
    if (d.end) setEnd(d.end);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/student/response-window", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start, end }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.student.responseWindow.saveError);
      return;
    }
    await load();
  }

  async function clearWindow() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/student/response-window", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clear: true }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.student.responseWindow.clearError);
      return;
    }
    await load();
  }

  if (!data) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-32 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  const isSet = !!(data.start && data.end);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.responseWindow.whenHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.responseWindow.whenBody}
        </p>
        {isSet && (
          <p className="text-sm text-tg-text">
            {ru.student.responseWindow.currentLine(data.start!, data.end!, data.tz)}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-4">
        {error && (
          <div className="text-xs text-tg-text-destructive">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-tg-text-hint">
              {ru.student.responseWindow.startLabel}
            </span>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full h-12 rounded-2xl bg-tg-bg-secondary px-3 text-tg-text tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-tg-text-hint">
              {ru.student.responseWindow.endLabel}
            </span>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full h-12 rounded-2xl bg-tg-bg-secondary px-3 text-tg-text tabular-nums"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="w-full h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? ru.student.responseWindow.savingButton : ru.student.responseWindow.saveButton}
        </button>
        {isSet && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearWindow()}
            className="w-full h-10 rounded-2xl bg-tg-bg-secondary text-tg-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            {ru.student.responseWindow.clearButton}
          </button>
        )}
      </section>
    </div>
  );
}
