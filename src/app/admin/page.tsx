"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable, type AdminUser } from "@/components/AdminUsersTable";
import { AdminLinksPanel } from "@/components/AdminLinksPanel";

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
 * Owns the shared user list so the role table and the linker dropdowns stay
 * in sync without a page reload. AdminUsersTable calls `refetch` after every
 * mutation; AdminLinksPanel just reads.
 */
function AdminBody({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/admin/users", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setLoaded(true);
      return;
    }
    const d = (await r.json()) as { users: AdminUser[] };
    setUsers(d.users);
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Catch out-of-band changes (other devices, /start from a new TG user) when
  // the Mini App returns to foreground.
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
      <AdminUsersTable jwt={jwt} users={users} loaded={loaded} refetch={refetch} />
      <AdminLinksPanel jwt={jwt} users={users} />
    </>
  );
}
