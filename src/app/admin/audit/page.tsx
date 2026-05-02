"use client";
import { AppShell } from "@/components/AppShell";
import { AuditLog } from "@/components/AuditLog";

export default function AdminAuditPage() {
  return (
    <AppShell title="Журнал" back="/admin">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для администраторов.
            </div>
          );
        }
        return <AuditLog jwt={jwt} />;
      }}
    </AppShell>
  );
}
