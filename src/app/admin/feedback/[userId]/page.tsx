"use client";
import { AppShell } from "@/components/AppShell";
import { FeedbackThread } from "@/components/FeedbackThread";
import { ru } from "@/lib/i18n";

export default function AdminFeedbackThreadPage({
  params,
}: {
  params: { userId: string };
}) {
  const userId = Number(params.userId);
  return (
    <AppShell title={ru.admin.pages.feedbackPageTitle} back="/admin/feedback">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.admin.pages.adminsOnly}
            </div>
          );
        }
        if (!Number.isInteger(userId)) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-destructive">
              {ru.admin.pages.invalidUserId}
            </div>
          );
        }
        return <FeedbackThread jwt={jwt} userId={userId} />;
      }}
    </AppShell>
  );
}
