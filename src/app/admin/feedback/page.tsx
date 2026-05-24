"use client";
import { AppShell } from "@/components/AppShell";
import { FeedbackList } from "@/components/FeedbackList";
import { ru } from "@/lib/i18n";

export default function AdminFeedbackPage() {
  return (
    <AppShell title={ru.admin.pages.feedbackPageTitle} back="/admin">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.admin.pages.adminsOnly}
            </div>
          );
        }
        return <FeedbackList jwt={jwt} />;
      }}
    </AppShell>
  );
}
