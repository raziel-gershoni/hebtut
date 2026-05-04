"use client";
import { useCallback, useEffect, useState } from "react";

interface SettingsResponse {
  settings: {
    quota_chat_notifications_enabled: boolean;
  };
}

export function AdminSettingsPanel({ jwt }: { jwt: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/settings", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as SettingsResponse;
    setEnabled(d.settings.quota_chat_notifications_enabled);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async () => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next); // optimistic
    const r = await fetch("/api/admin/settings", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "quota_chat_notifications_enabled",
        value: next,
      }),
    });
    if (!r.ok) {
      setEnabled(!next); // revert
      setError("Не удалось сохранить — попробуй ещё раз");
    }
    setBusy(false);
  }, [enabled, busy, jwt]);

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4">
      <h2 className="text-lg font-semibold tracking-tight">Настройки</h2>
      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Уведомления о лимите в чате</div>
          <div className="text-xs text-tg-text-hint mt-0.5">
            {enabled === null
              ? "Загрузка…"
              : enabled
                ? "Бот пишет ученику об остатке и исчерпании лимита."
                : "Бот молчит про лимит. Ученик видит остаток в мини-приложении."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={enabled === null || busy}
          aria-pressed={enabled === true}
          className={`shrink-0 inline-flex items-center justify-center min-w-[3.75rem] h-7 px-3 rounded-full text-xs font-semibold tabular-nums tracking-tight transition-all duration-150 active:scale-95 ring-1 ${
            enabled === true
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30"
              : "bg-tg-bg-secondary text-tg-text-hint ring-tg-text-hint/30"
          } disabled:opacity-50`}
        >
          {enabled === null ? "…" : enabled ? "ВКЛ" : "ВЫКЛ"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-tg-text-destructive">{error}</div>}
    </section>
  );
}
