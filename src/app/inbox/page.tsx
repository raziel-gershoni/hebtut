"use client";
import { AppShell } from "@/components/AppShell";
import { InboxList } from "@/components/InboxList";

export default function InboxPage() {
  return (
    <AppShell>
      {({ jwt, role }) => {
        if (role !== "teacher" && role !== "admin") return <p>Только для преподавателей.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Входящие</h1>
            <InboxList jwt={jwt} />
          </>
        );
      }}
    </AppShell>
  );
}
