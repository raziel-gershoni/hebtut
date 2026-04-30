"use client";
import { useState, useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Avatar } from "./Avatar";

export type AdminUser = {
  id: number;
  tg_user_id: number;
  name: string | null;
  role: "pending" | "student" | "teacher";
  is_admin: boolean;
  has_avatar: boolean;
  status: "active" | "suspended";
  created_at: string;
  role_changed_at: string | null;
};

const ROLES: AdminUser["role"][] = ["pending", "student", "teacher"];

const ROLE_LABEL: Record<AdminUser["role"], string> = {
  pending: "Ожидает",
  student: "Ученик",
  teacher: "Тренер",
};

type PendingChange =
  | { kind: "role"; id: number; role: AdminUser["role"] }
  | { kind: "admin"; id: number; is_admin: boolean }
  | { kind: "delete"; id: number; name: string; ban: boolean };

interface AdminUsersTableProps {
  jwt: string;
  users: AdminUser[];
  loaded: boolean;
  /** Called after every mutation so other consumers (e.g. AdminLinksPanel) re-render. */
  refetch: () => Promise<void>;
}

function avatarUrl(jwt: string, u: { id: number; has_avatar: boolean }): string | undefined {
  return u.has_avatar ? `/api/avatar/${u.id}?token=${encodeURIComponent(jwt)}` : undefined;
}

export function AdminUsersTable({ jwt, users, loaded, refetch }: AdminUsersTableProps) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [filter, setFilter] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  async function patchRole(id: number, body: { role?: AdminUser["role"]; is_admin?: boolean }) {
    await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refetch();
  }

  async function patchStatus(id: number, status: AdminUser["status"]) {
    await fetch(`/api/admin/users/${id}/status`, {
      method: "PATCH",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refetch();
  }

  async function deleteUser(id: number, ban: boolean) {
    const url = `/api/admin/users/${id}${ban ? "?ban=1" : ""}`;
    await fetch(url, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
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
        ROLE_LABEL[u.role].toLowerCase().includes(q),
    );
  }, [users, filter]);

  return (
    <section onClick={() => setOpenMenuId(null)}>
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Пользователи</h2>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void refetch();
          }}
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
            <Avatar
              name={u.name ?? String(u.tg_user_id)}
              isAdmin={u.is_admin}
              imageUrl={avatarUrl(jwt, u)}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-medium tracking-tight truncate flex items-center gap-2">
                <span className="truncate">{u.name ?? "—"}</span>
                {u.status === "suspended" && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                    На паузе
                  </span>
                )}
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
                else void patchRole(u.id, { role: next });
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
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
                  else void patchRole(u.id, { is_admin: next });
                }}
                className="h-4 w-4 rounded accent-tg-button"
              />
              <span>Админ</span>
            </label>
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Действия"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === u.id ? null : u.id);
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-tg-text-hint hover:text-tg-text transition-colors"
              >
                ⋯
              </button>
              {openMenuId === u.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-9 z-10 w-44 rounded-xl bg-tg-bg-section border border-tg-text-hint/15 shadow-xl py-1 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      void patchStatus(u.id, u.status === "suspended" ? "active" : "suspended");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                  >
                    {u.status === "suspended" ? "Возобновить" : "Приостановить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      setPending({ kind: "delete", id: u.id, name: u.name ?? "", ban: false });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors text-tg-text-destructive"
                  >
                    Удалить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      setPending({ kind: "delete", id: u.id, name: u.name ?? "", ban: true });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors text-tg-text-destructive"
                  >
                    Заблокировать навсегда
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "admin"
            ? "Снять права админа?"
            : pending?.kind === "delete"
              ? pending.ban
                ? "Заблокировать навсегда?"
                : "Удалить пользователя?"
              : "Подтвердить смену роли"
        }
        body={
          pending?.kind === "admin"
            ? "Без прав админа этот пользователь больше не сможет управлять пользователями и связями."
            : pending?.kind === "delete"
              ? pending.ban
                ? `${pending.name || "Пользователь"} не сможет зарегистрироваться заново. Все его сообщения будут удалены.`
                : `${pending.name || "Пользователь"} будет удалён вместе с сообщениями. Он сможет зарегистрироваться заново.`
              : "Это действие может разорвать существующие связи ученик↔тренер. Продолжить?"
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "role") await patchRole(pending.id, { role: pending.role });
          else if (pending.kind === "admin") await patchRole(pending.id, { is_admin: pending.is_admin });
          else if (pending.kind === "delete") await deleteUser(pending.id, pending.ban);
          setPending(null);
        }}
      />
    </section>
  );
}
