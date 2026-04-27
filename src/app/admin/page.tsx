"use client";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable } from "@/components/AdminUsersTable";
import { AdminLinksPanel } from "@/components/AdminLinksPanel";

export default function AdminPage() {
  return (
    <AppShell>
      {({ jwt, role }) => {
        if (role !== "admin") return <p>Только для администраторов.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Админка</h1>
            <AdminUsersTable jwt={jwt} />
            <AdminLinksPanel jwt={jwt} />
          </>
        );
      }}
    </AppShell>
  );
}
