"use client";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable } from "@/components/AdminUsersTable";
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
        return (
          <>
            <AdminUsersTable jwt={jwt} />
            <AdminLinksPanel jwt={jwt} />
          </>
        );
      }}
    </AppShell>
  );
}
