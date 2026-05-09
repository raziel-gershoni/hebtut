"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

interface FreezeData {
  remaining_days: number;
  budget_days: number;
  status: string | null;
  frozen_until_iso: string | null;
  current_period_ends_at_iso: string | null;
}

export default function FreezePage() {
  return (
    <AppShell title="Заморозка" back="/">
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
  const [data, setData] = useState<FreezeData | null>(null);
  const [pickedDays, setPickedDays] = useState<1 | 2 | 3 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/freeze", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    setData((await r.json()) as FreezeData);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    if (!pickedDays || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/student/freeze", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ days: pickedDays }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === "not_active"
          ? "Заморозка доступна только при активной подписке."
          : body.error === "budget_exceeded"
            ? "На этот месяц лимит уже исчерпан."
            : "Не получилось — попробуй позже.",
      );
      return;
    }
    setPickedDays(null);
    await load();
  }

  if (!data) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-32 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  const isFrozen = data.status === "frozen";
  const allowedMax = Math.min(3, data.remaining_days);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">Как работает</p>
        <p className="text-sm text-tg-text-subtitle">
          Можно заморозить доступ до {data.budget_days} дней в месяц.
        </p>
        <p className="text-sm text-tg-text-subtitle">
          Это продлит подписку на время паузы.
        </p>
        <p className="text-sm text-tg-text-subtitle">
          Заморозка действует со следующего дня после активации.
        </p>
      </section>

      {isFrozen ? (
        <section className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
          <p className="text-xs uppercase tracking-widest text-tg-text-hint">
            Сейчас на паузе
          </p>
          <p className="text-tg-text">
            Заморозка действует до{" "}
            <span className="font-medium tabular-nums">
              {formatDate(data.frozen_until_iso)}
            </span>
            .
          </p>
          <p className="text-sm text-tg-text-subtitle">
            Подписка автоматически продлится; новых заморозок до конца месяца
            доступно: <span className="tabular-nums">{data.remaining_days}</span>.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl bg-tg-bg-section p-5 space-y-3">
          <p className="text-xs uppercase tracking-widest text-tg-text-hint">
            Сколько дней заморозить
          </p>
          <p className="text-sm text-tg-text-subtitle">
            На этот месяц доступно: <span className="tabular-nums">{data.remaining_days}</span> из{" "}
            <span className="tabular-nums">{data.budget_days}</span>.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => {
              const allowed = n <= allowedMax;
              const picked = pickedDays === n;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!allowed || busy}
                  onClick={() => setPickedDays(n as 1 | 2 | 3)}
                  className={`h-12 rounded-2xl text-sm font-semibold transition-all ${
                    picked
                      ? "bg-tg-button text-tg-button-text"
                      : "bg-tg-bg-secondary text-tg-text"
                  } disabled:opacity-40`}
                >
                  {n} {n === 1 ? "день" : "дня"}
                </button>
              );
            })}
          </div>
          {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
          <button
            type="button"
            disabled={!pickedDays || busy || allowedMax === 0}
            onClick={() => void activate()}
            className="w-full h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "Включаем…" : "Заморозить со следующего дня"}
          </button>
        </section>
      )}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}
