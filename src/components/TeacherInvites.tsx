"use client";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";

interface InviteRow {
  id: number;
  token: string;
  url: string;
  created_at: string;
  consumed_at: string | null;
  consumed_by_name: string | null;
  revoked_at: string | null;
  state: "active" | "consumed" | "revoked";
}

const STATE_LABEL: Record<InviteRow["state"], string> = {
  active: "Активна",
  consumed: "Использована",
  revoked: "Отозвана",
};

const STATE_COLOR: Record<InviteRow["state"], string> = {
  active: "text-emerald-600 dark:text-emerald-400",
  consumed: "text-tg-text-hint",
  revoked: "text-tg-text-hint line-through",
};

export function TeacherInvites({ jwt }: { jwt: string }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [latest, setLatest] = useState<InviteRow | null>(null);
  const [copied, setCopied] = useState(false);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/admin/invites", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { invites: InviteRow[] };
      setInvites(d.invites);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function createInvite() {
    setCreating(true);
    setCopied(false);
    try {
      const r = await fetch("/api/admin/invites", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (r.ok) {
        const d = (await r.json()) as InviteRow;
        setLatest(d);
        await refetch();
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    await fetch(`/api/admin/invites/${id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (latest?.id === id) setLatest(null);
    await refetch();
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort. Some webviews block clipboard; fall back is the visible URL.
    }
  }

  return (
    <section className="mb-6">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Приглашения тренеров</h2>
        <button
          type="button"
          onClick={() => void createInvite()}
          disabled={creating}
          className="text-xs font-semibold tracking-tight text-tg-text-link disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {creating && <Spinner size={12} />}
          <span>+ Создать ссылку</span>
        </button>
      </header>

      {latest && (
        <div className="mb-3 rounded-2xl bg-tg-bg-section p-3 border border-emerald-500/40">
          <div className="text-xs text-tg-text-hint mb-1">Новая ссылка готова — отправь будущему тренеру:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs break-all bg-tg-bg-secondary rounded-lg px-2 py-1.5 font-mono">
              {latest.url}
            </code>
            <button
              type="button"
              onClick={() => void copyLink(latest.url)}
              className="shrink-0 h-9 px-3 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95"
            >
              {copied ? "✓" : "Копировать"}
            </button>
          </div>
        </div>
      )}

      {!loaded && (
        <ul className="space-y-2 animate-pulse">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="h-12 rounded-xl bg-tg-bg-secondary" />
          ))}
        </ul>
      )}

      {loaded && invites.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-4 text-center text-sm text-tg-text-hint">
          Пока нет ссылок. Создай первую.
        </div>
      )}

      {loaded && invites.length > 0 && (
        <ul className="space-y-1.5">
          {invites.map((i) => (
            <li
              key={i.id}
              className="rounded-xl bg-tg-bg-section px-3 py-2 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1 leading-tight">
                <div className={`text-xs font-semibold ${STATE_COLOR[i.state]}`}>
                  {STATE_LABEL[i.state]}
                  {i.consumed_by_name ? ` — ${i.consumed_by_name}` : ""}
                </div>
                <div className="text-[11px] text-tg-text-hint tabular-nums truncate">
                  {new Date(i.created_at).toLocaleString("ru-RU")}
                </div>
              </div>
              {i.state === "active" && (
                <>
                  <button
                    type="button"
                    onClick={() => void copyLink(i.url)}
                    className="shrink-0 text-xs text-tg-text-link transition-opacity active:opacity-60"
                  >
                    Копировать
                  </button>
                  <button
                    type="button"
                    onClick={() => void revoke(i.id)}
                    className="shrink-0 text-xs text-tg-text-destructive transition-opacity active:opacity-60"
                  >
                    Отозвать
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
