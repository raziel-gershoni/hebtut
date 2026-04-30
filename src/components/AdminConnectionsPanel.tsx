"use client";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { type AdminUser } from "./AdminUsersTable";
import { Spinner } from "./Spinner";

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
 * Combined view + add panel for the student↔teacher connection pool.
 * Top: compact add row (with already-linked detection).
 * Middle: filter input + по-ученикам / по-тренерам segmented toggle.
 * Bottom: groups, one card per primary entity, rows are the secondary
 * side with a per-row unlink ✕.
 */
export function AdminConnectionsPanel({
  jwt,
  users,
  links,
  refetch,
}: AdminConnectionsPanelProps) {
  const [studentId, setStudentId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("student");
  const [filter, setFilter] = useState("");
  // Set of "studentId:teacherId" pair keys currently being unlinked,
  // so each unlink button shows its own spinner without freezing siblings.
  const [unlinking, setUnlinking] = useState<Set<string>>(new Set());

  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  const linkedSet = useMemo(
    () => new Set(links.map((l) => `${l.student_id}:${l.teacher_id}`)),
    [links],
  );

  const hasAvatarById = useMemo(
    () => new Map(users.map((u) => [u.id, u.has_avatar])),
    [users],
  );

  function avatarUrlFor(id: number): string | undefined {
    return hasAvatarById.get(id)
      ? `/api/avatar/${id}?token=${encodeURIComponent(jwt)}`
      : undefined;
  }

  const alreadyLinked =
    studentId !== null &&
    teacherId !== null &&
    linkedSet.has(`${studentId}:${teacherId}`);

  async function handleAdd() {
    if (!studentId || !teacherId || alreadyLinked || addBusy) return;
    setAddBusy(true);
    try {
      const r = await fetch("/api/admin/links", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, teacherId }),
      });
      if (!r.ok) return;
      await refetch();
      // Keep studentId so the admin can keep adding more teachers to the
      // same student without re-picking them.
      setTeacherId(null);
    } finally {
      setAddBusy(false);
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

  const secondaryNoun = mode === "student" ? "преп." : "уч.";

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Связи</h2>
        <span className="text-xs text-tg-text-hint tabular-nums">
          {links.length}
        </span>
      </header>

      {/* Add controls */}
      <div className="rounded-2xl bg-tg-bg-section p-4 space-y-3 mb-3">
        <PickerRow
          label="Ученик"
          options={students}
          value={studentId}
          onChange={setStudentId}
        />
        <PickerRow
          label="Тренер"
          options={teachers}
          value={teacherId}
          onChange={setTeacherId}
        />
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            disabled={!studentId || !teacherId || alreadyLinked || addBusy}
            onClick={() => void handleAdd()}
            aria-busy={addBusy}
            className="flex-1 min-h-10 h-10 rounded-full bg-tg-button text-tg-button-text text-sm font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center"
          >
            {addBusy ? <Spinner /> : "Привязать"}
          </button>
          {alreadyLinked && (
            <span className="text-xs text-tg-text-hint">уже связаны</span>
          )}
        </div>
      </div>

      {/* Toggle + filter */}
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex rounded-full bg-tg-bg-secondary p-0.5 text-xs font-medium">
          <ToggleButton active={mode === "student"} onClick={() => setMode("student")}>
            По ученикам
          </ToggleButton>
          <ToggleButton active={mode === "teacher"} onClick={() => setMode("teacher")}>
            По тренерам
          </ToggleButton>
        </div>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Поиск по имени"
        className="w-full mb-3 h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
      />

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {links.length === 0 ? "Пока нет связей." : "Никого не нашлось."}
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
                      className="flex items-center gap-3 py-1 text-sm"
                    >
                      <span className="text-tg-text-hint" aria-hidden>
                        ↳
                      </span>
                      <span className="flex-1 truncate">{row.secondaryName}</span>
                      <button
                        type="button"
                        onClick={() => void handleUnlink(row.student_id, row.teacher_id)}
                        disabled={isUnlinking}
                        aria-busy={isUnlinking}
                        aria-label="Удалить связь"
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
        active
          ? "bg-tg-bg-section text-tg-text shadow-sm"
          : "text-tg-text-hint"
      }`}
    >
      {children}
    </button>
  );
}

function PickerRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: AdminUser[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
      >
        <option value="">— не выбрано —</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name ?? `ID ${u.id}`}
          </option>
        ))}
      </select>
    </label>
  );
}
