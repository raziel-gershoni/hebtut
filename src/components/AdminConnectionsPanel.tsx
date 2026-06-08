"use client";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { type AdminUser } from "./AdminUsersTable";
import { SearchableUserChecklist } from "./SearchableUserChecklist";
import { Spinner } from "./Spinner";
import { pluralLink, ru } from "@/lib/i18n";

export interface Connection {
  student_id: number;
  teacher_id: number;
  student_name: string | null;
  teacher_name: string | null;
  created_at: string;
}

interface AdminConnectionsPanelProps {
  jwt: string;
  users: AdminUser[];
  links: Connection[];
  refetch: () => Promise<void>;
}

type Mode = "student" | "teacher";

/**
 * Bulk pairing UI: pick N students × M teachers, see what will be created,
 * confirm all in one tap. Below: existing-links view for inspection +
 * per-row unlink. Replaces the previous single-pair-at-a-time picker; the
 * underlying single-link DELETE endpoint is still used by the per-row ✕.
 */
export function AdminConnectionsPanel({
  jwt,
  users,
  links,
  refetch,
}: AdminConnectionsPanelProps) {
  const [selectedStudents, setSelectedStudents] = useState<Set<number>>(new Set());
  const [selectedTeachers, setSelectedTeachers] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [recentResult, setRecentResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const [mode, setMode] = useState<Mode>("teacher");
  const [filter, setFilter] = useState("");
  const [unlinking, setUnlinking] = useState<Set<string>>(new Set());

  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  const linkedSet = useMemo(
    () => new Set(links.map((l) => `${l.student_id}:${l.teacher_id}`)),
    [links],
  );

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const hasAvatarById = useMemo(
    () => new Map(users.map((u) => [u.id, u.has_avatar])),
    [users],
  );

  function avatarUrlFor(id: number): string | undefined {
    return hasAvatarById.get(id)
      ? `/api/avatar/${id}?token=${encodeURIComponent(jwt)}`
      : undefined;
  }

  // Cross-product preview. We split into "to create" (new pairs) and
  // "already exist" (skipped). The button label tracks the to-create count.
  const preview = useMemo(() => {
    const toCreate: { studentId: number; teacherId: number }[] = [];
    const alreadyExist: { studentId: number; teacherId: number }[] = [];
    for (const sId of selectedStudents) {
      for (const tId of selectedTeachers) {
        if (linkedSet.has(`${sId}:${tId}`)) {
          alreadyExist.push({ studentId: sId, teacherId: tId });
        } else {
          toCreate.push({ studentId: sId, teacherId: tId });
        }
      }
    }
    return { toCreate, alreadyExist };
  }, [selectedStudents, selectedTeachers, linkedSet]);

  function toggleStudent(id: number) {
    setSelectedStudents((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setRecentResult(null);
  }
  function toggleTeacher(id: number) {
    setSelectedTeachers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setRecentResult(null);
  }

  async function handleBulkPair() {
    if (busy) return;
    if (preview.toCreate.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/links/bulk", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentIds: Array.from(selectedStudents),
          teacherIds: Array.from(selectedTeachers),
        }),
      });
      if (!r.ok) return;
      const result = (await r.json()) as {
        created: number;
        skipped: number;
        failed: number;
      };
      setRecentResult(result);
      setSelectedStudents(new Set());
      setSelectedTeachers(new Set());
      await refetch();
      // Auto-hide the result toast after a moment so it doesn't linger.
      window.setTimeout(() => setRecentResult(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(student_id: number, teacher_id: number) {
    const key = `${student_id}:${teacher_id}`;
    if (unlinking.has(key)) return;
    setUnlinking((s) => new Set(s).add(key));
    try {
      const r = await fetch("/api/admin/links", {
        method: "DELETE",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student_id, teacherId: teacher_id }),
      });
      if (!r.ok) return;
      await refetch();
    } finally {
      setUnlinking((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  const filteredLinks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return links;
    return links.filter(
      (l) =>
        (l.student_name ?? "").toLowerCase().includes(q) ||
        (l.teacher_name ?? "").toLowerCase().includes(q),
    );
  }, [links, filter]);

  const groups = useMemo(() => {
    const map = new Map<
      number,
      {
        primaryName: string;
        rows: { secondaryId: number; secondaryName: string; pairKey: string; student_id: number; teacher_id: number }[];
      }
    >();
    for (const link of filteredLinks) {
      const primaryId = mode === "student" ? link.student_id : link.teacher_id;
      const primaryName =
        mode === "student" ? link.student_name : link.teacher_name;
      const secondaryId = mode === "student" ? link.teacher_id : link.student_id;
      const secondaryName =
        mode === "student" ? link.teacher_name : link.student_name;
      if (!map.has(primaryId)) {
        map.set(primaryId, { primaryName: primaryName ?? "—", rows: [] });
      }
      map.get(primaryId)!.rows.push({
        secondaryId,
        secondaryName: secondaryName ?? "—",
        pairKey: `${link.student_id}:${link.teacher_id}`,
        student_id: link.student_id,
        teacher_id: link.teacher_id,
      });
    }
    return Array.from(map.entries()).map(([id, group]) => ({ id, ...group }));
  }, [filteredLinks, mode]);

  const secondaryNoun = mode === "student"
    ? ru.admin.connections.secondaryNounTeacher
    : ru.admin.connections.secondaryNounStudent;

  const buttonDisabled = busy || preview.toCreate.length === 0;
  const buttonLabel = (() => {
    if (busy) return null;
    if (selectedStudents.size === 0 || selectedTeachers.size === 0) {
      return ru.admin.connections.buttonChooseBoth;
    }
    if (preview.toCreate.length === 0 && preview.alreadyExist.length > 0) {
      return ru.admin.connections.buttonAllExist;
    }
    return ru.admin.connections.buttonPair(preview.toCreate.length, pluralLink(preview.toCreate.length));
  })();

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">{ru.admin.connections.sectionTitle}</h2>
        <span className="text-xs text-tg-text-hint tabular-nums">{links.length}</span>
      </header>

      {/* Bulk pairing UI — collapsed by default so inspect-only admins see the
          existing links right away. */}
      <details className="group/bulk mb-4 rounded-2xl border border-tg-text-hint/15">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 select-none">
          <span className="text-sm font-semibold tracking-tight">
            {ru.admin.connections.bulkPairTitle}
          </span>
          <span
            aria-hidden
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-tg-bg-secondary text-tg-text"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200 group-open/bulk:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SearchableUserChecklist
            jwt={jwt}
            users={students}
            selected={selectedStudents}
            onToggle={toggleStudent}
            label={ru.admin.connections.studentsLabel}
            emptyText={ru.admin.connections.studentsEmpty}
          />
          <SearchableUserChecklist
            jwt={jwt}
            users={teachers}
            selected={selectedTeachers}
            onToggle={toggleTeacher}
            label={ru.admin.connections.teachersLabel}
            emptyText={ru.admin.connections.teachersEmpty}
          />
        </div>

        {/* Selected chips strip — clear visual confirmation of what's about to happen */}
        {(selectedStudents.size > 0 || selectedTeachers.size > 0) && (
          <div className="rounded-2xl bg-tg-bg-secondary/40 p-3 space-y-2 text-xs">
            {selectedStudents.size > 0 && (
              <ChipRow
                label={ru.admin.connections.studentsLabel}
                ids={Array.from(selectedStudents)}
                usersById={usersById}
                onRemove={toggleStudent}
              />
            )}
            {selectedTeachers.size > 0 && (
              <ChipRow
                label={ru.admin.connections.teachersLabel}
                ids={Array.from(selectedTeachers)}
                usersById={usersById}
                onRemove={toggleTeacher}
              />
            )}
            {(selectedStudents.size > 0 && selectedTeachers.size > 0) && (
              <p className="text-[11px] text-tg-text-hint pt-1">
                {ru.admin.connections.willCreate}{" "}
                <span className="font-medium text-tg-text tabular-nums">
                  {preview.toCreate.length}
                </span>{" "}
                {pluralLink(preview.toCreate.length)}
                {preview.alreadyExist.length > 0 && (
                  <span className="text-tg-text-hint">
                    {" "}
                    {preview.alreadyExist.length === 1
                      ? ru.admin.connections.alreadyExistOne(preview.alreadyExist.length, pluralLink(preview.alreadyExist.length))
                      : ru.admin.connections.alreadyExistMany(preview.alreadyExist.length, pluralLink(preview.alreadyExist.length))}
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleBulkPair()}
          disabled={buttonDisabled}
          aria-busy={busy}
          className="w-full min-h-10 h-10 rounded-full bg-tg-button text-tg-button-text text-sm font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center"
        >
          {busy ? <Spinner /> : buttonLabel}
        </button>

        {recentResult && (
          <div className="rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-2 text-xs text-center font-medium">
            {ru.admin.connections.resultCreated(recentResult.created)}
            {recentResult.skipped > 0 && ru.admin.connections.resultSkipped(recentResult.skipped)}
            {recentResult.failed > 0 && ru.admin.connections.resultFailed(recentResult.failed)}
          </div>
        )}
      </div>
      </details>

      {/* Existing-links view — toggle + filter + groups */}
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex rounded-full bg-tg-bg-secondary p-0.5 text-xs font-medium">
          <ToggleButton active={mode === "student"} onClick={() => setMode("student")}>
            {ru.admin.connections.byStudents}
          </ToggleButton>
          <ToggleButton active={mode === "teacher"} onClick={() => setMode("teacher")}>
            {ru.admin.connections.byTeachers}
          </ToggleButton>
        </div>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={ru.admin.connections.searchPlaceholder}
        className="w-full mb-3 h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
      />

      {groups.length === 0 ? (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {links.length === 0 ? ru.admin.connections.noLinks : ru.admin.connections.noMatch}
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={`${mode}-${g.id}`} className="rounded-2xl bg-tg-bg-section p-3">
              <header className="flex items-center gap-3 mb-2">
                <Avatar name={g.primaryName} imageUrl={avatarUrlFor(g.id)} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="font-medium tracking-tight truncate">
                    {g.primaryName}
                  </div>
                  <div className="text-xs text-tg-text-hint tabular-nums">
                    {g.rows.length} {secondaryNoun}
                  </div>
                </div>
              </header>
              <ul className="pl-12 space-y-1">
                {g.rows.map((row) => {
                  const isUnlinking = unlinking.has(row.pairKey);
                  return (
                    <li
                      key={row.pairKey}
                      className="flex items-center gap-2 py-1 text-sm"
                    >
                      <Avatar
                        size={32}
                        name={row.secondaryName}
                        imageUrl={avatarUrlFor(row.secondaryId)}
                      />
                      <span className="flex-1 truncate">{row.secondaryName}</span>
                      <button
                        type="button"
                        onClick={() => void handleUnlink(row.student_id, row.teacher_id)}
                        disabled={isUnlinking}
                        aria-busy={isUnlinking}
                        aria-label={ru.admin.connections.unlinkLabel}
                        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-tg-text-hint hover:text-tg-text-destructive transition-colors active:scale-90 disabled:opacity-60"
                      >
                        {isUnlinking ? <Spinner size={12} /> : "✕"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChipRow({
  label,
  ids,
  usersById,
  onRemove,
}: {
  label: string;
  ids: number[];
  usersById: Map<number, AdminUser>;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-tg-text-hint text-[11px] uppercase tracking-wider mr-1">
        {label}:
      </span>
      {ids.map((id) => {
        const u = usersById.get(id);
        const name = u?.preferred_name ?? u?.name ?? ru.admin.connections.fallbackName(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onRemove(id)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tg-bg-section text-tg-text text-[11px] hover:bg-tg-text-destructive/10 hover:text-tg-text-destructive transition-colors"
          >
            <span className="truncate max-w-[8rem]">{name}</span>
            <span aria-hidden>✕</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 h-8 rounded-full transition-colors ${
        active ? "bg-tg-bg-section text-tg-text shadow-sm" : "text-tg-text-hint"
      }`}
    >
      {children}
    </button>
  );
}
