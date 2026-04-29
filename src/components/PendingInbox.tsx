"use client";
import { useState } from "react";
import { Avatar } from "./Avatar";
import { type AdminUser } from "./AdminUsersTable";
import { Spinner } from "./Spinner";

interface PendingInboxProps {
  jwt: string;
  users: AdminUser[];
  refetch: () => Promise<void>;
}

/**
 * Surfaces self-registered users (role='pending') as a triage zone at the
 * top of the admin page. Each card has two one-tap buttons — Ученик /
 * Преподаватель — that PATCH the role and remove the user from this
 * section (they reappear in the main table with their new role).
 *
 * Hidden entirely when there are 0 pending users.
 */
export function PendingInbox({ jwt, users, refetch }: PendingInboxProps) {
  const pending = users.filter((u) => u.role === "pending");
  if (pending.length === 0) return null;

  return (
    <section className="mb-8">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Ожидают подтверждения
        </h2>
        <span className="text-xs text-tg-text-hint tabular-nums">
          {pending.length}
        </span>
      </header>

      <ul className="space-y-2">
        {pending.map((u) => (
          <PendingCard key={u.id} jwt={jwt} user={u} refetch={refetch} />
        ))}
      </ul>
    </section>
  );
}

function PendingCard({
  jwt,
  user,
  refetch,
}: {
  jwt: string;
  user: AdminUser;
  refetch: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"student" | "teacher" | null>(null);

  async function approve(role: "student" | "teacher") {
    if (busy) return;
    setBusy(role);
    try {
      await fetch(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      await refetch();
      // No need to clear `busy` — the user will be filtered out of `pending`
      // on the next render and this component unmounts.
    } catch {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-2xl bg-tg-bg-section ring-1 ring-inset ring-tg-text-accent/15 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={user.name ?? String(user.tg_user_id)} isAdmin={user.is_admin} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-medium tracking-tight truncate">
            {user.name ?? "—"}
          </div>
          <div className="text-xs text-tg-text-hint tabular-nums truncate">
            {user.tg_user_id}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void approve("student")}
          aria-busy={busy === "student"}
          className="flex-1 min-h-9 h-9 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center"
        >
          {busy === "student" ? <Spinner /> : "Ученик"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void approve("teacher")}
          aria-busy={busy === "teacher"}
          className="flex-1 min-h-9 h-9 rounded-full bg-tg-button/15 text-tg-text-accent text-xs font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center"
        >
          {busy === "teacher" ? <Spinner /> : "Преподаватель"}
        </button>
      </div>
    </li>
  );
}
