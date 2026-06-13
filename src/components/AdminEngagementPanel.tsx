"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import { engagementMetricLine } from "@/lib/engagement-format";

interface FlagRow {
  student_id: number;
  kind: "inactive" | "slump" | "plateau" | "ghosting" | "tutor_sla";
  tier: string | null;
  opened_at: string;
  meta: Record<string, unknown>;
  severity: "red" | "yellow" | "grey";
  name: string;
  has_avatar: boolean;
}

const GROUPS: { severity: FlagRow["severity"]; title: string; dot: string }[] = [
  { severity: "red", title: ru.admin.engagement.groupNeedsAttention, dot: "🔴" },
  { severity: "yellow", title: ru.admin.engagement.groupSliding, dot: "🟡" },
  { severity: "grey", title: ru.admin.engagement.groupPlateau, dot: "⚪" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// For the inactive flag the cron stamps meta.since_date (YYYY-MM-DD, the first
// missed day in the student's tz) — show that as the «с» date rather than
// opened_at (= when the monitor first noticed). Sliced, not Date-parsed, to
// avoid the admin browser's tz shifting a date-only value across midnight.
function sinceFor(f: FlagRow): string {
  const since = f.meta.since_date;
  if (typeof since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const [, m, d] = since.split("-");
    return `${d}.${m}`;
  }
  return fmtDate(f.opened_at);
}

export function AdminEngagementPanel({ jwt }: { jwt: string }) {
  const [rows, setRows] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch("/api/admin/engagement", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setError(ru.admin.engagement.loadError);
      return;
    }
    const d = (await r.json()) as { flags: FlagRow[] };
    setRows(d.flags);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium">
        {error}
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="text-center py-6">
        <Spinner />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
        {ru.admin.engagement.emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const groupRows = rows.filter((r) => r.severity === g.severity);
        if (groupRows.length === 0) return null;
        return (
          <section key={g.severity}>
            <h3 className="text-sm font-semibold tracking-tight mb-2">
              {g.dot} {g.title} ({groupRows.length})
            </h3>
            <ul className="space-y-2">
              {groupRows.map((f) => (
                <li
                  key={`${f.student_id}:${f.kind}`}
                  className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
                >
                  <Avatar
                    name={f.name}
                    size={36}
                    imageUrl={
                      f.has_avatar
                        ? `/api/avatar/${f.student_id}?token=${encodeURIComponent(jwt)}`
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="font-medium tracking-tight truncate">{f.name}</div>
                    <div className="mt-0.5 text-[11px] text-tg-text-hint truncate">
                      {engagementMetricLine(f.kind, f.meta)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-tg-text-hint tabular-nums">
                    {ru.admin.engagement.sinceDate(sinceFor(f))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
