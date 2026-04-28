"use client";
import { useState, useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type AdminUser = {
  id: number;
  tg_user_id: number;
  name: string | null;
  role: "pending" | "student" | "teacher";
  is_admin: boolean;
  status: string;
  created_at: string;
  role_changed_at: string | null;
};

const ROLES: AdminUser["role"][] = ["pending", "student", "teacher"];

type PendingChange =
  | { kind: "role"; id: number; role: AdminUser["role"] }
  | { kind: "admin"; id: number; is_admin: boolean };

interface AdminUsersTableProps {
  jwt: string;
  users: AdminUser[];
  loaded: boolean;
  /** Called after every mutation so other consumers (e.g. AdminLinksPanel) re-render. */
  refetch: () => Promise<void>;
}

export function AdminUsersTable({ jwt, users, loaded, refetch }: AdminUsersTableProps) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [filter, setFilter] = useState("");

  async function patch(id: number, body: { role?: AdminUser["role"]; is_admin?: boolean }) {
    await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refetch();
  }

  function isDestructiveRole(current: AdminUser["role"], next: AdminUser["role"]): boolean {
    if (current === next) return false;
    if (current === "teacher" || current === "student") return true;
    return false;
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        String(u.tg_user_id).includes(q) ||
        u.role.includes(q),
    );
  }, [users, filter]);

  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Пользователи</h2>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-xs text-tg-text-link tracking-wider uppercase tabular-nums transition-opacity active:opacity-60"
          aria-label="Обновить список"
        >
          ↻ {users.length}
        </button>
      </header>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Поиск по имени, ID или роли"
        className="w-full mb-3 h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
      />

      {!loaded && (
        <ul className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-16 rounded-2xl bg-tg-bg-secondary" />
          ))}
        </ul>
      )}

      {loaded && filtered.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          Никого не нашлось.
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((u) => (
          <li
            key={u.id}
            className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
          >
            <Avatar name={u.name ?? String(u.tg_user_id)} isAdmin={u.is_admin} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-medium tracking-tight truncate">
                {u.name ?? "—"}
              </div>
              <div className="text-xs text-tg-text-hint tabular-nums truncate">
                {u.tg_user_id}
              </div>
            </div>
            <select
              aria-label="Роль"
              className="shrink-0 h-8 pl-2 pr-7 rounded-lg bg-tg-bg-secondary text-tg-text text-xs font-medium outline-none focus:ring-2 focus:ring-tg-button/40"
              value={u.role}
              onChange={(e) => {
                const next = e.target.value as AdminUser["role"];
                if (next === u.role) return;
                if (isDestructiveRole(u.role, next))
                  setPending({ kind: "role", id: u.id, role: next });
                else void patch(u.id, { role: next });
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label className="shrink-0 inline-flex items-center gap-1.5 text-xs text-tg-text-hint cursor-pointer select-none">
              <input
                type="checkbox"
                checked={u.is_admin}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (!next && u.is_admin)
                    setPending({ kind: "admin", id: u.id, is_admin: false });
                  else void patch(u.id, { is_admin: next });
                }}
                className="h-4 w-4 rounded accent-tg-button"
              />
              <span>Админ</span>
            </label>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "admin" ? "Снять права админа?" : "Подтвердить смену роли"}
        body={
          pending?.kind === "admin"
            ? "Без прав админа этот пользователь больше не сможет управлять пользователями и связями."
            : "Это действие может разорвать существующие связи студент↔преподаватель. Продолжить?"
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "role") await patch(pending.id, { role: pending.role });
          else await patch(pending.id, { is_admin: pending.is_admin });
          setPending(null);
        }}
      />
    </section>
  );
}

function Avatar({ name, isAdmin }: { name: string; isAdmin?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const ring = isAdmin ? "ring-1 ring-tg-text-accent/60" : "";
  return (
    <div
      className={`shrink-0 w-9 h-9 rounded-full bg-tg-bg-secondary text-tg-text flex items-center justify-center text-xs font-semibold tracking-tight ${ring}`}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}
