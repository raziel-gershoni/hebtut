"use client";
import { AppShell } from "@/components/AppShell";
import { ThreadView } from "@/components/ThreadView";

export default function StudentThreadPage({ params }: { params: { id: string } }) {
  const studentId = Number(params.id);
  return (
    <AppShell back="/inbox">
      {({ jwt, role, isAdmin, userId, name }) => {
        if (role !== "teacher" && !isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для преподавателей.
            </div>
          );
        }
        if (!Number.isInteger(studentId)) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-destructive">
              Неверный идентификатор ученика.
            </div>
          );
        }
        return (
          <ThreadView jwt={jwt} studentId={studentId} myUserId={userId} myName={name} />
        );
      }}
    </AppShell>
  );
}
