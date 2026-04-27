"use client";
import { AppShell } from "@/components/AppShell";
import { InboxList } from "@/components/InboxList";

export default function InboxPage() {
  return (
    <AppShell title="Входящие" back="/">
      {({ jwt, role }) => {
        if (role !== "teacher" && role !== "admin") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для преподавателей.
            </div>
          );
        }
        return <InboxList jwt={jwt} />;
      }}
    </AppShell>
  );
}
