"use client";
import { AppShell } from "@/components/AppShell";
import { AuditLog } from "@/components/AuditLog";
import { ru } from "@/lib/i18n";

export default function AdminAuditPage() {
  return (
    <AppShell title={ru.admin.pages.auditPageTitle} back="/admin">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.admin.pages.adminsOnly}
            </div>
          );
        }
        return <AuditLog jwt={jwt} />;
      }}
    </AppShell>
  );
}
