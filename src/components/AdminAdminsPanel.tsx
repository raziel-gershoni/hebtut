"use client";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import type { AdminUser } from "./AdminUsersTable";

interface AdminAdminsPanelProps {
  jwt: string;
  /** users.id of the admin viewing the panel — drives the self-revoke warning. */
  selfId: number;
  users: AdminUser[];
  loaded: boolean;
  /** Page-owned refetch so the users table and connections panel stay in sync. */
  refetch: () => Promise<void>;
}

type PendingChange =
  | { kind: "grant"; user: AdminUser }
  | { kind: "revoke"; user: AdminUser };

function avatarUrl(jwt: string, u: { id: number; has_avatar: boolean }): string | undefined {
  return u.has_avatar ? `/api/avatar/${u.id}?token=${encodeURIComponent(jwt)}` : undefined;
}

function displayName(u: AdminUser): string {
  return u.preferred_name ?? u.name ?? `#${u.tg_user_id}`;
}

/**
 * Dedicated grant/revoke surface for the is_admin flag. Replaces the old
 * per-row 👤/👑 toggle in AdminUsersTable, where granting fired on a single
 * unconfirmed tap (a misclick made a student an admin in prod). Both
 * directions now require opening this panel and passing a ConfirmDialog;
 * granting additionally requires picking the user from a search dialog.
 *
 * No API changes: PATCH /api/admin/users/[id]/role already mutates
 * is_admin and records the admin.is_admin_change audit event. Bootstrap
 * admins are intentionally NOT special-cased — revoking one is allowed
 * and ensureBootstrapAdmin silently re-grants on the next cold start.
 */
export function AdminAdminsPanel({ jwt, selfId, users, loaded, refetch }: AdminAdminsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const admins = useMemo(() => users.filter((u) => u.is_admin), [users]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !u.is_admin)
      .filter(
        (u) =>
          !q ||
          (u.preferred_name ?? "").toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.tg_username ?? "").toLowerCase().includes(q),
      );
  }, [users, query]);

  async function patchIsAdmin(id: number, is_admin: boolean): Promise<void> {
    setError(null);
    const r = await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_admin }),
    });
    if (!r.ok) {
      setError(ru.admin.admins.saveError);
      return;
    }
    await refetch();
  }

  return (
    <section>
      {error && (
        <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium mb-3">
          {error}
        </div>
      )}

      {!loaded && (
        <div className="text-center py-6">
          <Spinner />
        </div>
      )}

      {loaded && admins.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {ru.admin.admins.emptyList}
        </div>
      )}

      {loaded && admins.length > 0 && (
        <ul className="space-y-2">
          {admins.map((u) => (
            <li
              key={u.id}
              className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
            >
              <Avatar name={displayName(u)} isAdmin imageUrl={avatarUrl(jwt, u)} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-medium tracking-tight truncate">{displayName(u)}</div>
                <div className="mt-0.5 text-[11px] text-tg-text-hint truncate tabular-nums">
                  {u.tg_username ? `@${u.tg_username} · ` : ""}
                  {u.tg_user_id}
                </div>
              </div>
              <button
                type="button"
                aria-label={ru.admin.admins.revokeAria(displayName(u))}
                title={ru.admin.admins.revokeAria(displayName(u))}
                onClick={() => setPending({ kind: "revoke", user: u })}
                className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg bg-tg-bg-secondary text-tg-text-hint transition-transform active:scale-95"
              >
                <span aria-hidden>✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loaded && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setQuery("");
            setPickerOpen(true);
          }}
          className="mt-3 w-full min-h-10 h-10 rounded-full bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99]"
        >
          + {ru.admin.admins.addButton}
        </button>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-40 animate-fade-in">
          <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold tracking-tight">{ru.admin.admins.pickerTitle}</h2>
              <button
                type="button"
                aria-label={ru.common.close}
                onClick={() => setPickerOpen(false)}
                className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-tg-bg-secondary text-tg-text-hint"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ru.admin.admins.searchPlaceholder}
              className="w-full h-10 px-3 mb-3 rounded-xl bg-tg-bg-secondary text-tg-text text-sm outline-none focus:ring-2 focus:ring-tg-button/40"
            />
            <ul className="space-y-1 overflow-y-auto flex-1 min-h-0">
              {candidates.length === 0 && (
                <li className="p-4 text-center text-sm text-tg-text-hint">
                  {ru.admin.admins.pickerEmpty}
                </li>
              )}
              {candidates.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setPending({ kind: "grant", user: u })}
                    className="w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors active:bg-tg-bg-secondary/60"
                  >
                    <Avatar name={displayName(u)} imageUrl={avatarUrl(jwt, u)} size={32} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-sm font-medium truncate">{displayName(u)}</div>
                      <div className="text-[11px] text-tg-text-hint truncate tabular-nums">
                        {u.tg_username ? `@${u.tg_username} · ` : ""}
                        {u.tg_user_id}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "grant"
            ? ru.admin.admins.confirmGrantTitle
            : ru.admin.admins.confirmRevokeTitle
        }
        body={
          pending?.kind === "grant"
            ? ru.admin.admins.confirmGrantBody(displayName(pending.user))
            : pending
              ? pending.user.id === selfId
                ? ru.admin.admins.confirmRevokeSelfBody
                : ru.admin.admins.confirmRevokeBody(displayName(pending.user))
              : ""
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await patchIsAdmin(pending.user.id, pending.kind === "grant");
          setPending(null);
          setPickerOpen(false);
        }}
      />
    </section>
  );
}
