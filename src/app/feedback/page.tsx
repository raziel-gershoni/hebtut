"use client";
import { ru } from "@/lib/i18n";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { FeedbackChat } from "@/components/FeedbackChat";

export default function FeedbackPage() {
  return (
    <AppShell title={ru.inbox.feedbackPage.pageTitle} back="/">
      {({ jwt, isAdmin }) => {
        if (isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-subtitle space-y-3">
              <p>{ru.inbox.feedbackPage.adminHint}</p>
              <Link
                href="/admin/feedback"
                className="inline-flex items-center gap-1 text-sm font-semibold text-tg-text-link"
              >
                {ru.inbox.feedbackPage.adminNav}
              </Link>
            </div>
          );
        }
        return <FeedbackChat jwt={jwt} />;
      }}
    </AppShell>
  );
}
