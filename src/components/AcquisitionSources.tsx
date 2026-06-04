"use client";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";

interface SourceRow {
  id: number;
  slug: string;
  label: string;
  url: string;
  created_at: string;
  revoked_at: string | null;
  state: "active" | "revoked";
  signup_count: number;
}

const STATE_LABEL: Record<SourceRow["state"], string> = ru.admin.acquisitionSources.stateLabels;

const STATE_COLOR: Record<SourceRow["state"], string> = {
  active: "text-emerald-600 dark:text-emerald-400",
  revoked: "text-tg-text-hint line-through",
};

export function AcquisitionSources({ jwt }: { jwt: string }) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [latest, setLatest] = useState<SourceRow | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/admin/acquisition-sources", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { sources: SourceRow[] };
      setSources(d.sources);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function createSource() {
    if (!label.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/admin/acquisition-sources", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (r.ok) {
        const d = (await r.json()) as SourceRow;
        setLatest(d);
        setLabel("");
        await refetch();
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    await fetch(`/api/admin/acquisition-sources/${id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (latest?.id === id) setLatest(null);
    await refetch();
  }

  async function copyLink(id: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Best-effort; visible URL is the fallback.
    }
  }

  return (
    <section className="mb-6">
      <header className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {ru.admin.acquisitionSources.sectionTitle}
        </h2>
        <p className="mt-1 text-xs text-tg-text-hint leading-snug">
          {ru.admin.acquisitionSources.hint}
        </p>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createSource();
            }
          }}
          placeholder={ru.admin.acquisitionSources.labelPlaceholder}
          maxLength={80}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
        />
        <button
          type="button"
          onClick={() => void createSource()}
          disabled={creating || !label.trim()}
          aria-busy={creating}
          className="shrink-0 h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 min-w-[5rem]"
        >
          {creating && <Spinner size={12} />}
          <span>{ru.admin.acquisitionSources.createButton}</span>
        </button>
      </div>

      {latest && (
        <div className="mb-3 rounded-2xl bg-tg-bg-section p-3 border border-emerald-500/40">
          <div className="text-xs text-tg-text-hint mb-1">{latest.label}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs break-all bg-tg-bg-secondary rounded-lg px-2 py-1.5 font-mono">
              {latest.url}
            </code>
            <button
              type="button"
              onClick={() => void copyLink(latest.id, latest.url)}
              className="shrink-0 h-9 px-3 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95"
            >
              {copiedId === latest.id
                ? ru.admin.acquisitionSources.copiedTick
                : ru.admin.acquisitionSources.copyButton}
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

      {loaded && sources.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-4 text-center text-sm text-tg-text-hint">
          {ru.admin.acquisitionSources.emptyState}
        </div>
      )}

      {loaded && sources.length > 0 && (
        <ul className="space-y-1.5">
          {sources.map((s) => (
            <li
              key={s.id}
              className="rounded-xl bg-tg-bg-section px-3 py-2 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-sm font-medium truncate">{s.label}</div>
                <div className="text-[11px] tabular-nums truncate">
                  <span className={STATE_COLOR[s.state]}>{STATE_LABEL[s.state]}</span>
                  <span className="text-tg-text-hint">
                    {" · "}
                    {ru.admin.acquisitionSources.signupCount(s.signup_count)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copyLink(s.id, s.url)}
                className="shrink-0 text-xs text-tg-text-link transition-opacity active:opacity-60"
              >
                {copiedId === s.id
                  ? ru.admin.acquisitionSources.copiedTick
                  : ru.admin.acquisitionSources.copyButton}
              </button>
              {s.state === "active" && (
                <button
                  type="button"
                  onClick={() => void revoke(s.id)}
                  className="shrink-0 text-xs text-tg-text-destructive transition-opacity active:opacity-60"
                >
                  {ru.admin.acquisitionSources.revokeButton}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
