"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

interface WindowData {
  start: string | null;
  end: string | null;
  tz: string;
}

export default function ResponseWindowPage() {
  return (
    <AppShell title="Время ответа" back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для учеников.
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
    await fetch("/api/student/response-window", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start, end }),
    });
    setBusy(false);
    await load();
  }

  async function clearWindow() {
    setBusy(true);
    await fetch("/api/student/response-window", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clear: true }),
    });
    setBusy(false);
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
          Когда тренеру можно начинать диалог
        </p>
        <p className="text-sm text-tg-text-subtitle">
          Если тренер пишет первым — сообщение придёт только в выбранное время.
          На твои голосовые тренер отвечает сразу, без задержек.
        </p>
        {isSet && (
          <p className="text-sm text-tg-text">
            Сейчас: {data.start} — {data.end} ({data.tz})
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-tg-text-hint">
              С
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
              До
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
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        {isSet && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearWindow()}
            className="w-full h-10 rounded-2xl bg-tg-bg-secondary text-tg-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            Получать в любое время
          </button>
        )}
      </section>
    </div>
  );
}
