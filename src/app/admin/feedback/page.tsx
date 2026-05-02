"use client";
import { AppShell } from "@/components/AppShell";
import { FeedbackList } from "@/components/FeedbackList";

export default function AdminFeedbackPage() {
  return (
    <AppShell title="Обратная связь" back="/admin">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для администраторов.
            </div>
          );
        }
        return <FeedbackList jwt={jwt} />;
      }}
    </AppShell>
  );
}
