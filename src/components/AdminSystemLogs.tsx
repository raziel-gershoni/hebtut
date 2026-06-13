"use client";
import { useCallback, useState } from "react";
import { Spinner } from "./Spinner";
import { CollapsibleSection } from "./CollapsibleSection";
import { ru } from "@/lib/i18n";

interface LogRow {
  id: number;
  created_at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  meta: Record<string, unknown>;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const LEVEL_BADGE: Record<LogRow["level"], string> = {
  info: "bg-tg-bg-secondary text-tg-text-hint",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function hasMeta(meta: Record<string, unknown> | null | undefined): boolean {
  return !!meta && typeof meta === "object" && Object.keys(meta).length > 0;
}

export function AdminSystemLogs({ jwt }: { jwt: string }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // No source filter — show every source (store-media writes, media-read
      // routing, media-proxy fallback) so the panel covers the whole pipeline.
      const r = await fetch("/api/admin/system-logs?limit=200", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        setError(ru.admin.systemLogs.loadError);
        return;
      }
      const d = (await r.json()) as { logs: LogRow[] };
      setRows(d.logs);
    } catch {
      setError(ru.admin.systemLogs.loadError);
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  // Lazy-load: only fetch the first time the section is expanded.
  const handleToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (e.currentTarget.open && !loadedOnce) {
        setLoadedOnce(true);
        void load();
      }
    },
    [loadedOnce, load],
  );

  return (
    <CollapsibleSection
      id="system-logs"
      title={ru.admin.systemLogs.title}
      onToggle={handleToggle}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-tg-text-hint">{ru.admin.systemLogs.hint}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-full bg-tg-bg-secondary px-3 py-1 text-xs font-medium text-tg-text disabled:opacity-50"
          >
            {ru.admin.systemLogs.refresh}
          </button>
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium">
            {error}
          </div>
        ) : loading && !rows ? (
          <div className="text-center py-6">
            <Spinner />
          </div>
        ) : rows && rows.length === 0 ? (
          <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
            {ru.admin.systemLogs.empty}
          </div>
        ) : rows ? (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-2xl bg-tg-bg-section p-3 leading-tight">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[11px] text-tg-text-hint tabular-nums">
                    {fmtTime(row.created_at)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${LEVEL_BADGE[row.level]}`}
                  >
                    {row.level}
                  </span>
                  <span className="shrink-0 rounded-full bg-tg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-tg-text-hint">
                    {row.source}
                  </span>
                </div>
                <div className="mt-1 text-sm break-words">{row.message}</div>
                {hasMeta(row.meta) ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-tg-text-hint select-none">
                      meta
                    </summary>
                    <pre className="mt-1 text-[11px] whitespace-pre-wrap break-all">
                      {JSON.stringify(row.meta, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
