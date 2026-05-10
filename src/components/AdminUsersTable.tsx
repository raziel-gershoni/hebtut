"use client";
import { useState, useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Avatar } from "./Avatar";
import { SubscriptionDialog, type SubscriptionInfo } from "./SubscriptionDialog";

export type AdminUser = {
  id: number;
  tg_user_id: number;
  tg_username: string | null;
  name: string | null;
  display_handle: string | null;
  display_emoji: string | null;
  role: "pending" | "student" | "teacher";
  is_admin: boolean;
  has_avatar: boolean;
  status: "active" | "suspended";
  created_at: string;
  role_changed_at: string | null;
  subscription: SubscriptionInfo | null;
};

const ROLE_LABEL: Record<AdminUser["role"], string> = {
  pending: "Ожидает",
  student: "Ученик",
  teacher: "Тренер",
};

const ROLE_DEFS: Record<
  Exclude<AdminUser["role"], "pending">,
  { emoji: string; fillClass: string; label: string }
> = {
  student: {
    emoji: "🎓",
    fillClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    label: "Ученик",
  },
  teacher: {
    emoji: "📚",
    fillClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    label: "Тренер",
  },
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
  const [subscriptionUser, setSubscriptionUser] = useState<AdminUser | null>(null);

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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.tg_username ?? "").toLowerCase().includes(q) ||
        (u.display_handle ?? "").toLowerCase().includes(q) ||
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

      <div className="mb-2 flex items-center gap-2 text-xs text-tg-text-hint flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>🎓</span>
          <span>Ученик</span>
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>📚</span>
          <span>Тренер</span>
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>👑</span>
          <span>Админ</span>
        </span>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Поиск по имени, @username, псевдониму, ID или роли"
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
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-tg-text-hint min-w-0 flex-wrap">
                {u.tg_username && (
                  <>
                    <span className="truncate">@{u.tg_username}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className="tabular-nums">{u.tg_user_id}</span>
                {u.display_handle && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-tg-bg-secondary/60 text-tg-text">
                      <span aria-hidden>{u.display_emoji ?? "·"}</span>
                      <span>{u.display_handle}</span>
                    </span>
                  </>
                )}
                {u.role === "student" && u.subscription && (
                  <>
                    <span aria-hidden>·</span>
                    <SubscriptionBadge sub={u.subscription} />
                  </>
                )}
              </div>
            </div>
            {(() => {
              const def = u.role !== "pending" ? ROLE_DEFS[u.role] : null;
              const nextRole: AdminUser["role"] = u.role === "teacher" ? "student" : "teacher";
              const nextLabel = ROLE_LABEL[nextRole];
              return (
                <button
                  type="button"
                  title={def ? `Сделать ${nextLabel.toLowerCase()}` : "Не назначено"}
                  aria-label={def ? `Сделать ${nextLabel.toLowerCase()}` : "Роль не назначена"}
                  disabled={!def}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!def) return;
                    setPending({ kind: "role", id: u.id, role: nextRole });
                  }}
                  className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-base transition-transform active:scale-95 disabled:opacity-50 ${
                    def ? def.fillClass : "bg-tg-bg-secondary text-tg-text-hint"
                  }`}
                >
                  <span aria-hidden>{def?.emoji ?? "❓"}</span>
                </button>
              );
            })()}
            <button
              type="button"
              title={u.is_admin ? "Снять права админа" : "Сделать админом"}
              aria-label={u.is_admin ? "Снять права админа" : "Сделать админом"}
              aria-pressed={u.is_admin}
              onClick={(e) => {
                e.stopPropagation();
                if (u.is_admin)
                  setPending({ kind: "admin", id: u.id, is_admin: false });
                else void patchRole(u.id, { is_admin: true });
              }}
              className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-base transition-transform active:scale-95 ${
                u.is_admin
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-tg-bg-secondary text-tg-text-hint/60"
              }`}
            >
              <span aria-hidden>{u.is_admin ? "👑" : "👤"}</span>
            </button>
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
                  {u.role === "student" && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        setSubscriptionUser(u);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                    >
                      Подписка
                    </button>
                  )}
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

      <SubscriptionDialog
        open={!!subscriptionUser}
        jwt={jwt}
        userId={subscriptionUser?.id ?? 0}
        userName={subscriptionUser?.name ?? ""}
        subscription={subscriptionUser?.subscription ?? null}
        onClose={() => setSubscriptionUser(null)}
        onChanged={refetch}
      />

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

/* -------------------------------------------------------------------------
 * Per-row subscription state at a glance. Keeps the row tight: one chip
 * with a status-coded color + the most relevant date. Tap "Подписка" in
 * the kebab menu to mutate; this badge is read-only.
 * ----------------------------------------------------------------------- */
function SubscriptionBadge({ sub }: { sub: SubscriptionInfo }) {
  const tone = (() => {
    switch (sub.status) {
      case "active":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
      case "trial":
        return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
      case "frozen":
        return "bg-tg-bg-secondary text-tg-text-hint";
      case "trial_expired":
      case "lapsed":
      case "payment_failed":
        return "bg-tg-text-destructive/10 text-tg-text-destructive";
    }
  })();
  const label = (() => {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    switch (sub.status) {
      case "trial":
        return `trial → ${fmt(sub.trial_ends_at)}`;
      case "active":
        return sub.current_period_ends_at ? `до ${fmt(sub.current_period_ends_at)}` : "активна";
      case "frozen":
        return sub.frozen_until ? `🧊 ${fmt(sub.frozen_until)}` : "🧊";
      case "trial_expired":
        return "trial ✕";
      case "lapsed":
        return "закрыта";
      case "payment_failed":
        return "оплата ✕";
    }
  })();
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}
