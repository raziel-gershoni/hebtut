"use client";
import { ru } from "@/lib/i18n";
import { AppShell } from "@/components/AppShell";
import { InboxList } from "@/components/InboxList";

export default function InboxPage() {
  return (
    <AppShell title={ru.inbox.inboxPage.pageTitle} back="/">
      {({ jwt, role, isAdmin, userId }) => {
        if (role !== "teacher" && !isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.inbox.inboxPage.teachersOnly}
            </div>
          );
        }
        return <InboxList jwt={jwt} myUserId={userId} role={role} />;
      }}
    </AppShell>
  );
}
