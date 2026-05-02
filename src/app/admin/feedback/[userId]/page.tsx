"use client";
import { AppShell } from "@/components/AppShell";
import { FeedbackThread } from "@/components/FeedbackThread";

export default function AdminFeedbackThreadPage({
  params,
}: {
  params: { userId: string };
}) {
  const userId = Number(params.userId);
  return (
    <AppShell title="Обратная связь" back="/admin/feedback">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для администраторов.
            </div>
          );
        }
        if (!Number.isInteger(userId)) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-destructive">
              Неверный идентификатор пользователя.
            </div>
          );
        }
        return <FeedbackThread jwt={jwt} userId={userId} />;
      }}
    </AppShell>
  );
}
