"use client";
import { AppShell } from "@/components/AppShell";
import { ThreadView } from "@/components/ThreadView";

export default function StudentThreadPage({ params }: { params: { id: string } }) {
  const studentId = Number(params.id);
  return (
    <AppShell>
      {({ jwt, role }) => {
        if (role !== "teacher" && role !== "admin") return <p>Только для преподавателей.</p>;
        if (!Number.isInteger(studentId)) return <p>Неверный идентификатор ученика.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Диалог</h1>
            <ThreadView jwt={jwt} studentId={studentId} />
          </>
        );
      }}
    </AppShell>
  );
}
