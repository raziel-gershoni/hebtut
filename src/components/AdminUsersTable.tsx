"use client";
import { useState, useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Avatar } from "./Avatar";
import { SubscriptionDialog, type SubscriptionInfo } from "./SubscriptionDialog";
import { EditPreferredNameDialog } from "./EditPreferredNameDialog";
import { EditUserTranscriptsDialog } from "./EditUserTranscriptsDialog";
import { ru } from "@/lib/i18n";

export type AdminUser = {
  id: number;
  tg_user_id: number;
  tg_username: string | null;
  name: string | null;
  preferred_name: string | null;
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

const ROLE_DEFS: Record<
  Exclude<AdminUser["role"], "pending">,
  { emoji: string; fillClass: string; label: string }
> = {
  student: {
    emoji: "🎓",
    fillClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    label: ru.admin.users.roleLabels.student,
  },
  teacher: {
    emoji: "📚",
    fillClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    label: ru.admin.users.roleLabels.teacher,
  },
};

type PendingChange =
  | { kind: "role"; id: number; role: AdminUser["role"] }
  | { kind: "admin"; id: number; is_admin: boolean }
  | { kind: "delete"; id: number; name: string; ban: boolean }
  | { kind: "reset-onboarding"; id: number; name: string };

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

// Opens the user's TG profile from the admin Mini App.
// - With @username: canonical t.me URL via openTelegramLink — direct.
// - Without @username: not navigable from a Mini App at all (Telegram
//   docs flag tg://user?id= as "Bot API only"). The workaround is to
//   ask the server to DM the admin a text-mention message; tapping
//   that mention in the bot chat opens the profile. Caller handles
//   the async flow and the closing nudge.
function openTgProfileByUsername(username: string): void {
  const tg = window.Telegram?.WebApp;
  const url = `https://t.me/${username}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

export function AdminUsersTable({ jwt, users, loaded, refetch }: AdminUsersTableProps) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [filter, setFilter] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [profileNudge, setProfileNudge] = useState<string | null>(null);

  async function openProfile(u: AdminUser): Promise<void> {
    if (u.tg_username) {
      openTgProfileByUsername(u.tg_username);
      return;
    }
    // No public username — ask the server to DM us a text-mention
    // message in the bot chat. Tapping that mention is the only route
    // to the profile.
    const r = await fetch(`/api/admin/users/${u.id}/profile-link`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setProfileNudge(ru.admin.users.openTgProfileSendFailed);
      window.setTimeout(() => setProfileNudge(null), 3000);
      return;
    }
    setProfileNudge(ru.admin.users.openTgProfileSentToBot);
    window.setTimeout(() => setProfileNudge(null), 3500);
  }
  const [subscriptionUser, setSubscriptionUser] = useState<AdminUser | null>(null);
  const [editingNameUser, setEditingNameUser] = useState<AdminUser | null>(null);
  const [transcriptsUser, setTranscriptsUser] = useState<AdminUser | null>(null);

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

  async function resetOnboarding(id: number) {
    await fetch(`/api/admin/users/${id}/reset-onboarding`, {
      method: "POST",
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
        (u.preferred_name ?? "").toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.tg_username ?? "").toLowerCase().includes(q) ||
        (u.display_handle ?? "").toLowerCase().includes(q) ||
        String(u.tg_user_id).includes(q) ||
        ru.admin.users.roleLabels[u.role].toLowerCase().includes(q),
    );
  }, [users, filter]);

  return (
    <section onClick={() => setOpenMenuId(null)}>
      {profileNudge && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 rounded-2xl bg-tg-bg-section border border-tg-text-hint/15 shadow-xl px-4 py-3 text-sm text-tg-text"
        >
          {profileNudge}
        </div>
      )}
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">{ru.admin.users.sectionTitle}</h2>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void refetch();
          }}
          className="text-xs text-tg-text-link tracking-wider uppercase tabular-nums transition-opacity active:opacity-60"
          aria-label={ru.admin.users.refreshLabel}
        >
          ↻ {users.length}
        </button>
      </header>

      <div className="mb-2 flex items-center gap-2 text-xs text-tg-text-hint flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>🎓</span>
          <span>{ru.admin.users.legendStudent}</span>
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>📚</span>
          <span>{ru.admin.users.legendTeacher}</span>
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>👑</span>
          <span>{ru.admin.users.legendAdmin}</span>
        </span>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={ru.admin.users.searchPlaceholder}
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
          {ru.admin.users.empty}
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((u) => (
          <li
            key={u.id}
            className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void openProfile(u);
              }}
              aria-label={ru.admin.users.openTgProfileAria}
              className="flex items-center gap-3 min-w-0 flex-1 -mx-1 px-1 py-1 rounded-xl text-left transition-colors active:bg-tg-bg-secondary/60"
            >
              <Avatar
                name={u.name ?? String(u.tg_user_id)}
                isAdmin={u.is_admin}
                imageUrl={avatarUrl(jwt, u)}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-medium tracking-tight truncate flex items-center gap-2">
                  <span className="truncate">{u.preferred_name ?? u.name ?? "—"}</span>
                  {u.status === "suspended" && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                      {ru.admin.users.suspendedBadge}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-tg-text-hint min-w-0 flex-wrap">
                {u.preferred_name && u.name && (
                  <>
                    <span className="truncate" title={ru.admin.users.tgNameTitle}>
                      {ru.admin.users.tgNamePrefix} {u.name}
                    </span>
                    <span aria-hidden>·</span>
                  </>
                )}
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
            </button>
            {(() => {
              const def = u.role !== "pending" ? ROLE_DEFS[u.role] : null;
              const nextRole: AdminUser["role"] = u.role === "teacher" ? "student" : "teacher";
              const nextLabel = ru.admin.users.roleLabels[nextRole];
              return (
                <button
                  type="button"
                  title={def ? ru.admin.users.roleSwitchTitle(nextLabel.toLowerCase()) : ru.admin.users.roleSwitchUnassignedTitle}
                  aria-label={def ? ru.admin.users.roleSwitchAriaLabel(nextLabel.toLowerCase()) : ru.admin.users.roleSwitchUnassignedAriaLabel}
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
              title={u.is_admin ? ru.admin.users.adminTitleOn : ru.admin.users.adminTitleOff}
              aria-label={u.is_admin ? ru.admin.users.adminTitleOn : ru.admin.users.adminTitleOff}
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
                aria-label={ru.admin.users.actionsAriaLabel}
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
                      setEditingNameUser(u);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                  >
                    {ru.admin.users.menuEditName}
                  </button>
                  {u.role === "student" && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        setSubscriptionUser(u);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                    >
                      {ru.admin.users.menuSubscription}
                    </button>
                  )}
                  {u.role === "student" && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        setPending({
                          kind: "reset-onboarding",
                          id: u.id,
                          name: u.preferred_name ?? u.name ?? "",
                        });
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                    >
                      {ru.admin.users.menuResetOnboarding}
                    </button>
                  )}
                  {u.role === "student" && u.subscription && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        setTranscriptsUser(u);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors"
                    >
                      {ru.admin.userTranscripts.menuItem}
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
                    {u.status === "suspended" ? ru.admin.users.menuResume : ru.admin.users.menuSuspend}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      setPending({ kind: "delete", id: u.id, name: u.name ?? "", ban: false });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors text-tg-text-destructive"
                  >
                    {ru.admin.users.menuDelete}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      setPending({ kind: "delete", id: u.id, name: u.name ?? "", ban: true });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-tg-bg-secondary transition-colors text-tg-text-destructive"
                  >
                    {ru.admin.users.menuBanForever}
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

      <EditPreferredNameDialog
        open={!!editingNameUser}
        jwt={jwt}
        userId={editingNameUser?.id ?? 0}
        tgName={editingNameUser?.name ?? null}
        preferredName={editingNameUser?.preferred_name ?? null}
        onClose={() => setEditingNameUser(null)}
        onSaved={refetch}
      />

      <EditUserTranscriptsDialog
        open={!!transcriptsUser}
        jwt={jwt}
        userId={transcriptsUser?.id ?? 0}
        initialTranscripts={transcriptsUser?.subscription?.transcripts_enabled ?? true}
        initialTranslation={transcriptsUser?.subscription?.translation_enabled ?? true}
        onClose={() => setTranscriptsUser(null)}
        onSaved={refetch}
      />

      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "admin"
            ? ru.admin.users.confirmAdminOffTitle
            : pending?.kind === "delete"
              ? pending.ban
                ? ru.admin.users.confirmBanTitle
                : ru.admin.users.confirmDeleteTitle
              : pending?.kind === "reset-onboarding"
                ? ru.admin.users.confirmResetOnboardingTitle
                : ru.admin.users.confirmRoleTitle
        }
        body={
          pending?.kind === "admin"
            ? ru.admin.users.confirmAdminOffBody
            : pending?.kind === "delete"
              ? pending.ban
                ? ru.admin.users.confirmBanBody(pending.name)
                : ru.admin.users.confirmDeleteBody(pending.name)
              : pending?.kind === "reset-onboarding"
                ? ru.admin.users.confirmResetOnboardingBody(pending.name)
                : ru.admin.users.confirmRoleBody
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "role") await patchRole(pending.id, { role: pending.role });
          else if (pending.kind === "admin") await patchRole(pending.id, { is_admin: pending.is_admin });
          else if (pending.kind === "delete") await deleteUser(pending.id, pending.ban);
          else if (pending.kind === "reset-onboarding") await resetOnboarding(pending.id);
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
      case "queued":
        return "bg-tg-bg-secondary text-tg-text-subtitle";
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
      case "queued":
        return ru.admin.users.subBadgeQueued;
      case "trial":
        return ru.admin.users.subBadgeTrial(fmt(sub.trial_ends_at));
      case "active":
        return sub.current_period_ends_at
          ? ru.admin.users.subBadgeActiveUntil(fmt(sub.current_period_ends_at))
          : ru.admin.users.subBadgeActive;
      case "frozen":
        return sub.frozen_until
          ? ru.admin.users.subBadgeFrozenUntil(fmt(sub.frozen_until))
          : ru.admin.users.subBadgeFrozen;
      case "trial_expired":
        return ru.admin.users.subBadgeTrialExpired;
      case "lapsed":
        return ru.admin.users.subBadgeLapsed;
      case "payment_failed":
        return ru.admin.users.subBadgePaymentFailed;
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
