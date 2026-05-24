"use client";

import { BUILD_INFO, commitUrl } from "@/lib/build-info";
import { ru } from "@/lib/i18n";

/**
 * Tiny footer at the bottom of /admin showing the running git SHA, branch,
 * commit message, and build time. Linked to the commit on GitHub when
 * we have a repo slug. Purely informational — used to answer "is the
 * bundle I'm testing the one I just pushed?" without leaving the panel.
 */
export function AdminVersionFooter() {
  if (!BUILD_INFO.sha) {
    return (
      <div className="mt-6 mb-2 text-[10px] text-tg-text-hint text-center opacity-60">
        {ru.admin.versionFooter.unknown}
      </div>
    );
  }
  const url = commitUrl();
  const builtAt = BUILD_INFO.builtAt ? new Date(BUILD_INFO.builtAt) : null;
  const builtAtLabel = builtAt
    ? builtAt.toLocaleString("ru-RU", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="mt-6 mb-2 text-[10px] text-tg-text-hint text-center opacity-70 space-y-0.5 leading-tight">
      <div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-mono hover:underline"
          >
            {BUILD_INFO.shaShort}
          </a>
        ) : (
          <span className="font-mono">{BUILD_INFO.shaShort}</span>
        )}
        {BUILD_INFO.ref && <span> · {BUILD_INFO.ref}</span>}
      </div>
      {BUILD_INFO.message && (
        <div className="truncate max-w-xs mx-auto" title={BUILD_INFO.message}>
          {BUILD_INFO.message}
        </div>
      )}
      {builtAtLabel && (
        <div title={builtAt?.toISOString() ?? undefined}>
          {ru.admin.versionFooter.builtPrefix} {builtAtLabel}
        </div>
      )}
    </div>
  );
}
