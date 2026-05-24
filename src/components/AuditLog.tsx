"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtimeAudit } from "@/hooks/useRealtimeAudit";
import { ru } from "@/lib/i18n";

interface ActorRef {
  id: number;
  name: string | null;
  display_handle: string | null;
}

interface AuditEvent {
  id: number;
  created_at: string;
  actor: ActorRef | null;
  action: string;
  subject_type: string | null;
  subject_id: number | null;
  meta: Record<string, unknown>;
}

type ActionDef = { label: string; tone: string; group: string };
const A = ru.admin.audit.actions;
const G = ru.admin.audit.groups;
const ACTION_DEFS: Record<string, ActionDef> = {
  "claim.refresh": { label: A["claim.refresh"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.sessions },
  "claim.expire": { label: A["claim.expire"], tone: "bg-tg-bg-secondary text-tg-text-hint", group: G.sessions },
  "message.in": { label: A["message.in"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.messages },
  "message.out": { label: A["message.out"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.messages },
  "admin.role_change": { label: A["admin.role_change"], tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", group: G.admin },
  "admin.is_admin_change": { label: A["admin.is_admin_change"], tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", group: G.admin },
  "admin.status_change": { label: A["admin.status_change"], tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", group: G.admin },
  "admin.user_delete": { label: A["admin.user_delete"], tone: "bg-rose-500/15 text-rose-700 dark:text-rose-400", group: G.admin },
  "admin.user_ban": { label: A["admin.user_ban"], tone: "bg-rose-500/15 text-rose-700 dark:text-rose-400", group: G.admin },
  "admin.user_unban": { label: A["admin.user_unban"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.admin },
  "admin.invite_create": { label: A["admin.invite_create"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.invites },
  "admin.invite_revoke": { label: A["admin.invite_revoke"], tone: "bg-tg-bg-secondary text-tg-text-hint", group: G.invites },
  "admin.link_create": { label: A["admin.link_create"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.links },
  "admin.link_delete": { label: A["admin.link_delete"], tone: "bg-tg-bg-secondary text-tg-text-hint", group: G.links },
  "invite.consume": { label: A["invite.consume"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.invites },
  "signup.student": { label: A["signup.student"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.registration },
  "signup.teacher": { label: A["signup.teacher"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.registration },
  "feedback.in": { label: A["feedback.in"], tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400", group: G.feedback },
  "feedback.out": { label: A["feedback.out"], tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", group: G.feedback },
  "feedback.claim_refresh": { label: A["feedback.claim_refresh"], tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", group: G.feedback },
  "feedback.claim_expire": { label: A["feedback.claim_expire"], tone: "bg-tg-bg-secondary text-tg-text-hint", group: G.feedback },
};

const ACTION_OPTIONS = Object.entries(ACTION_DEFS).map(([value, def]) => ({
  value,
  label: def.label,
  group: def.group,
}));

const RANGE_OPTIONS = [
  { value: "1h", label: ru.admin.audit.rangeOptions["1h"] },
  { value: "24h", label: ru.admin.audit.rangeOptions["24h"] },
  { value: "7d", label: ru.admin.audit.rangeOptions["7d"] },
  { value: "30d", label: ru.admin.audit.rangeOptions["30d"] },
];

function rangeToSinceIso(range: string): string {
  const ms = range === "1h" ? 60 * 60 * 1000 : range === "24h" ? 24 * 60 * 60 * 1000 : range === "30d" ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metaSummary(action: string, meta: Record<string, unknown>): string {
  // Cheap one-line summary; full JSON is in the expandable panel.
  if (action === "claim.refresh") {
    const kind = meta.kind ? `kind=${meta.kind}` : "";
    const exp = meta.expires_at
      ? `exp=${new Date(meta.expires_at as string).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
      : "";
    return [kind, exp].filter(Boolean).join(", ");
  }
  if (action === "message.in" || action === "message.out") {
    const dur = typeof meta.duration === "number" ? `${meta.duration}s` : "";
    const reply = meta.reply_to_id ? `↩#${meta.reply_to_id}` : "";
    return [meta.kind, dur, reply].filter(Boolean).join(" ");
  }
  if (action === "admin.role_change" || action === "admin.status_change" || action === "admin.is_admin_change") {
    return `${meta.from} → ${meta.to}`;
  }
  if (action === "admin.user_delete" || action === "admin.user_ban") {
    const snap = (meta.snapshot ?? {}) as Record<string, unknown>;
    return `${snap.name ?? snap.tg_user_id ?? "?"} (${snap.role ?? "?"})`;
  }
  if (action === "admin.link_create" || action === "admin.link_delete") {
    return `S#${meta.student_id} ↔ T#${meta.teacher_id}`;
  }
  if (action === "claim.expire") {
    return `T#${meta.teacher_id ?? "?"}`;
  }
  return "";
}

export function AuditLog({ jwt }: { jwt: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [actionFilter, setActionFilter] = useState<string[]>([]);
  const [actorFilter, setActorFilter] = useState<string>("");
  const [subjectIdFilter, setSubjectIdFilter] = useState<string>("");
  const [range, setRange] = useState<string>("7d");

  const buildQuery = useCallback(
    (extra?: { before?: number }): string => {
      const p = new URLSearchParams();
      if (actionFilter.length > 0) p.set("action", actionFilter.join(","));
      if (actorFilter) p.set("actor", actorFilter);
      if (subjectIdFilter) p.set("subject_id", subjectIdFilter);
      p.set("since", rangeToSinceIso(range));
      p.set("limit", "100");
      if (extra?.before) p.set("before", String(extra.before));
      return p.toString();
    },
    [actionFilter, actorFilter, subjectIdFilter, range],
  );

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/audit?${buildQuery()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { events: AuditEvent[]; has_more: boolean; next_cursor: number | null };
      setEvents(d.events);
      setHasMore(d.has_more);
    }
    setLoaded(true);
  }, [jwt, buildQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (events.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestId = events[events.length - 1]!.id;
      const r = await fetch(`/api/admin/audit?${buildQuery({ before: oldestId })}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (r.ok) {
        const d = (await r.json()) as { events: AuditEvent[]; has_more: boolean };
        setEvents((prev) => [...prev, ...d.events]);
        setHasMore(d.has_more);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  // Realtime: prepend new audit_events as they're inserted.
  const onRealtimeInsert = useCallback(() => {
    // Cheapest: refetch the first page so filters + actor joins stay correct.
    void load();
  }, [load]);
  useRealtimeAudit(jwt, onRealtimeInsert);

  const grouped = useMemo(() => {
    const groups: { name: string; options: { value: string; label: string }[] }[] = [];
    const byGroup = new Map<string, { value: string; label: string }[]>();
    for (const opt of ACTION_OPTIONS) {
      const arr = byGroup.get(opt.group) ?? [];
      arr.push({ value: opt.value, label: opt.label });
      byGroup.set(opt.group, arr);
    }
    for (const [name, options] of byGroup) groups.push({ name, options });
    return groups;
  }, []);

  function toggleAction(value: string) {
    setActionFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function clearAllFilters() {
    setActionFilter([]);
    setActorFilter("");
    setSubjectIdFilter("");
    setRange("7d");
  }

  const filtersActive = actionFilter.length > 0 || actorFilter !== "" || subjectIdFilter !== "" || range !== "7d";

  return (
    <section>
      <div className="sticky top-0 z-10 bg-tg-bg pb-3 mb-3 -mx-3 px-3 border-b border-tg-text-hint/15">
        <header className="flex items-baseline justify-between gap-3 mb-2 pt-1">
          <h2 className="text-lg font-semibold tracking-tight">{ru.admin.audit.sectionTitle}</h2>
          {filtersActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-tg-text-link"
            >
              {ru.admin.audit.resetFilters}
            </button>
          )}
        </header>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {grouped.map((g) => (
            <details key={g.name} className="relative">
              <summary className="cursor-pointer list-none inline-flex items-center gap-1 px-2.5 h-7 rounded-full bg-tg-bg-secondary text-xs font-medium text-tg-text">
                {g.name}
                {actionFilter.some((v) => g.options.find((o) => o.value === v)) && (
                  <span className="ml-1 text-tg-text-link tabular-nums">
                    {actionFilter.filter((v) => g.options.find((o) => o.value === v)).length}
                  </span>
                )}
              </summary>
              <div className="absolute left-0 top-8 z-20 min-w-[180px] rounded-xl bg-tg-bg-section border border-tg-text-hint/15 shadow-xl p-1.5 space-y-1">
                {g.options.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-tg-bg-secondary cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={actionFilter.includes(opt.value)}
                      onChange={() => toggleAction(opt.value)}
                      className="h-4 w-4 accent-tg-button"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </details>
          ))}

          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="h-7 px-2 rounded-full bg-tg-bg-secondary text-xs font-medium text-tg-text"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <input
            type="number"
            placeholder={ru.admin.audit.actorPlaceholder}
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-tg-bg-secondary text-tg-text text-sm placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
          />
          <input
            type="number"
            placeholder={ru.admin.audit.subjectPlaceholder}
            value={subjectIdFilter}
            onChange={(e) => setSubjectIdFilter(e.target.value)}
            className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-tg-bg-secondary text-tg-text text-sm placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
          />
        </div>
      </div>

      {!loaded && (
        <ul className="space-y-1.5 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="h-12 rounded-xl bg-tg-bg-secondary" />
          ))}
        </ul>
      )}

      {loaded && events.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {ru.admin.audit.empty}
        </div>
      )}

      <ul className="space-y-1">
        {events.map((e) => {
          const def = ACTION_DEFS[e.action] ?? {
            label: e.action,
            tone: "bg-tg-bg-secondary text-tg-text-hint",
            group: ru.admin.audit.groups.unknown,
          };
          const summary = metaSummary(e.action, e.meta);
          const expanded = expandedId === e.id;
          return (
            <li
              key={e.id}
              className="rounded-xl bg-tg-bg-section"
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : e.id)}
                className="w-full text-left px-3 py-2 flex items-start gap-2"
              >
                <span className="shrink-0 text-[11px] tabular-nums text-tg-text-hint w-14 leading-snug pt-0.5">
                  {formatTime(e.created_at)}
                </span>
                <span
                  className={`shrink-0 inline-flex items-center px-2 h-5 rounded-md text-[11px] font-semibold ${def.tone}`}
                >
                  {def.label}
                </span>
                <span className="min-w-0 flex-1 text-xs text-tg-text leading-snug pt-0.5">
                  <span className="font-medium">
                    {e.actor ? e.actor.name ?? e.actor.display_handle ?? `#${e.actor.id}` : ru.admin.audit.systemActor}
                  </span>
                  {e.subject_type && e.subject_id != null && (
                    <span className="text-tg-text-hint"> · {e.subject_type}#{e.subject_id}</span>
                  )}
                  {summary && <span className="text-tg-text-hint"> · {summary}</span>}
                </span>
              </button>
              {expanded && (
                <pre className="px-3 pb-2 text-[11px] text-tg-text-hint whitespace-pre-wrap break-all">
{JSON.stringify(e.meta, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium disabled:opacity-50"
          >
            {loadingMore ? ru.admin.audit.loadingMore : ru.admin.audit.loadMore}
          </button>
        </div>
      )}
    </section>
  );
}
