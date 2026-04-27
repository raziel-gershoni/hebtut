"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type AdminUser = {
  id: number;
  tg_user_id: number;
  name: string | null;
  role: "pending" | "student" | "teacher" | "admin";
  status: string;
  created_at: string;
  role_changed_at: string | null;
};

const ROLES: AdminUser["role"][] = ["pending", "student", "teacher", "admin"];

const ROLE_PILL: Record<AdminUser["role"], string> = {
  pending: "bg-tg-bg-secondary text-tg-text-hint",
  student: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  teacher: "bg-tg-button/15 text-tg-text-accent",
  admin: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
};

export function AdminUsersTable({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<{ id: number; role: AdminUser["role"] } | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } });
    const d = (await r.json()) as { users: AdminUser[] };
    setUsers(d.users);
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(id: number, role: AdminUser["role"]) {
    await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
  }

  function isDestructive(current: AdminUser["role"], next: AdminUser["role"]): boolean {
    if (current === "admin" && next !== "admin") return true;
    if (current === "teacher" && (next === "pending" || next === "student")) return true;
    if (current === "student" && (next === "pending" || next === "teacher")) return true;
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
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Пользователи</h2>
        <span className="text-xs text-tg-text-hint tabular-nums">{users.length}</span>
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
            <Avatar name={u.name ?? String(u.tg_user_id)} />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{u.name ?? "—"}</div>
              <div className="text-xs text-tg-text-hint tabular-nums">
                ID {u.tg_user_id}
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium uppercase tracking-wider ${ROLE_PILL[u.role]}`}
            >
              {u.role}
            </span>
            <select
              aria-label="Изменить роль"
              className="shrink-0 h-9 px-2 rounded-lg bg-tg-bg-secondary text-tg-text text-sm outline-none focus:ring-2 focus:ring-tg-button/40"
              value={u.role}
              onChange={(e) => {
                const next = e.target.value as AdminUser["role"];
                if (next === u.role) return;
                if (isDestructive(u.role, next)) setPending({ id: u.id, role: next });
                else void changeRole(u.id, next);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!pending}
        title="Подтвердить смену роли"
        body="Это действие может разорвать существующие связи студент↔преподаватель. Продолжить?"
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (pending) await changeRole(pending.id, pending.role);
          setPending(null);
        }}
      />
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  return (
    <div
      className="shrink-0 w-9 h-9 rounded-full bg-tg-bg-secondary text-tg-text flex items-center justify-center text-xs font-semibold tracking-tight"
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}
