"use client";
import { useCallback, useEffect, useState } from "react";
import { formatDuration } from "@/lib/i18n";

interface QuotaResponse {
  used_seconds: number;
  remaining_seconds: number;
  daily_quota_seconds: number;
  reset_at_iso: string;
  notifications_enabled: boolean;
}

/**
 * Russian "сброс через Xч Yмин" — relative is more useful than absolute,
 * since the student is reading the card to plan the next message right
 * now, not to look up a wall-clock time.
 */
function formatResetIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "скоро";
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export function StudentQuotaCard({ jwt }: { jwt: string }) {
  const [data, setData] = useState<QuotaResponse | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/quota", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as QuotaResponse;
    setData(d);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [load]);

  if (!data) {
    return (
      <section className="rounded-2xl bg-tg-bg-section p-5 animate-pulse">
        <div className="h-4 w-20 rounded bg-tg-bg-secondary" />
        <div className="mt-3 h-6 w-40 rounded bg-tg-bg-secondary" />
        <div className="mt-3 h-1.5 w-full rounded-full bg-tg-bg-secondary" />
      </section>
    );
  }

  const pct = Math.min(
    100,
    Math.round((data.used_seconds / Math.max(1, data.daily_quota_seconds)) * 100),
  );
  const exhausted = data.remaining_seconds <= 0;
  const barClass = exhausted ? "bg-amber-500" : "bg-tg-text-accent";

  return (
    <section className="rounded-2xl bg-tg-bg-section p-5">
      <p className="text-xs uppercase tracking-widest text-tg-text-hint">Сегодня</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatDuration(data.used_seconds)}
        </span>
        <span className="text-sm text-tg-text-hint tabular-nums">
          / {formatDuration(data.daily_quota_seconds)}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-tg-bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${barClass} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline gap-2 text-xs text-tg-text-hint">
        {exhausted ? (
          <span>Лимит на сегодня исчерпан · сброс через {formatResetIn(data.reset_at_iso)}</span>
        ) : (
          <span>
            Осталось{" "}
            <span className="text-tg-text tabular-nums">
              {formatDuration(data.remaining_seconds)}
            </span>{" "}
            · сброс через {formatResetIn(data.reset_at_iso)}
          </span>
        )}
      </div>
      {!data.notifications_enabled && (
        <div className="mt-2 text-[11px] text-tg-text-hint">
          Уведомления о лимите в чате выключены — следи здесь.
        </div>
      )}
    </section>
  );
}
