"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable, type AdminUser } from "@/components/AdminUsersTable";
import {
  AdminConnectionsPanel,
  type Connection,
} from "@/components/AdminConnectionsPanel";
import { TeacherInvites } from "@/components/TeacherInvites";
import { BannedUsersPanel } from "@/components/BannedUsersPanel";
import { AdminSettingsPanel } from "@/components/AdminSettingsPanel";
import { AdminTagsManager } from "@/components/AdminTagsManager";

export default function AdminPage() {
  return (
    <AppShell title="Админка" back="/">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для администраторов.
            </div>
          );
        }
        return <AdminBody jwt={jwt} />;
      }}
    </AppShell>
  );
}

/**
 * Owns the shared `users` and `links` lists so the pending inbox, role
 * table, and connections panel all stay in sync without page reloads.
 */
function AdminBody({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [links, setLinks] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const headers = { Authorization: `Bearer ${jwt}` };
    const [uRes, lRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store", headers }),
      fetch("/api/admin/links", { cache: "no-store", headers }),
    ]);
    if (uRes.ok) {
      const u = (await uRes.json()) as { users: AdminUser[] };
      setUsers(u.users);
    }
    if (lRes.ok) {
      const l = (await lRes.json()) as { links: Connection[] };
      setLinks(l.links);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Catch out-of-band changes (other devices, /start from a fresh TG user)
  // when the Mini App returns to foreground.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/admin/feedback"
          className="inline-flex items-center gap-1 text-sm font-semibold text-tg-text-link"
        >
          → Обратная связь
        </Link>
        <Link
          href="/admin/audit"
          className="inline-flex items-center gap-1 text-sm font-semibold text-tg-text-link"
        >
          → Журнал действий
        </Link>
      </div>
      <AdminSettingsPanel jwt={jwt} />
      <AdminTagsManager jwt={jwt} />
      <TeacherInvites jwt={jwt} />
      <AdminUsersTable jwt={jwt} users={users} loaded={loaded} refetch={refetch} />
      <BannedUsersPanel jwt={jwt} />
      <AdminConnectionsPanel jwt={jwt} users={users} links={links} refetch={refetch} />
    </>
  );
}
