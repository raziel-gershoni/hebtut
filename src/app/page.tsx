"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SubscriberSummary } from "@/components/SubscriberSummary";
import { MiniAppMenu } from "@/components/MiniAppMenu";
import { ru } from "@/lib/i18n";

const ROLE_LABEL: Record<string, string> = ru.student.home.roleLabels;

export default function Home() {
  return (
    <AppShell>
      {({ jwt, role, isAdmin, name }) => (
        <div className="space-y-6">
          {/* Greeting card. Students don't need it: their SubscriberSummary
              below already shows the name as a heading and a context-aware
              main line, and the bot's own /start reply covers the
              "record-a-voice" hint. Without this guard the home stacked
              two text panels with the name duplicated — see spec table
              at https://docs.google.com/document/d/1eKf0xxZh5tOyI2XUmYWHX9292N4FnEeCtq9jueVYcDs */}
          {role !== "student" && (
            <section className="rounded-2xl bg-tg-bg-section p-5">
              <div className="flex items-center gap-2">
                <p className="text-xs uppercase tracking-widest text-tg-text-hint">
                  {ROLE_LABEL[role] ?? role}
                </p>
                {isAdmin && (
                  <span className="text-[10px] font-semibold tracking-widest px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400">
                    {ru.student.home.adminTag}
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {ru.student.home.greeting(name ?? ru.student.home.fallbackName)}
              </h1>
              {role === "pending" && !isAdmin && (
                <p className="mt-3 text-sm text-tg-text-subtitle">
                  {ru.student.home.pendingHint}
                </p>
              )}
              {isAdmin && role !== "teacher" && (
                <p className="mt-3 text-sm text-tg-text-subtitle">
                  {ru.student.home.adminHint}
                </p>
              )}
            </section>
          )}

          {role === "student" && (
            <>
              <SubscriberSummary jwt={jwt} />
              <MiniAppMenu jwt={jwt} />
            </>
          )}

          {(role === "teacher" || isAdmin) && (
            <ActionCard
              href="/inbox"
              title={ru.student.home.inboxTitle}
              subtitle={
                role === "teacher"
                  ? ru.student.home.inboxSubtitleTeacher
                  : ru.student.home.inboxSubtitleAdmin
              }
              icon="📥"
            />
          )}

          {role !== "student" && (
            <ActionCard
              href={isAdmin ? "/admin/feedback" : "/feedback"}
              title={ru.student.home.feedbackTitle}
              subtitle={
                isAdmin
                  ? ru.student.home.feedbackSubtitleAdmin
                  : ru.student.home.feedbackSubtitleUser
              }
              icon="💬"
            />
          )}

          {isAdmin && (
            <ActionCard
              href="/admin"
              title={ru.student.home.adminPanelTitle}
              subtitle={ru.student.home.adminPanelSubtitle}
              icon="⚙️"
            />
          )}
        </div>
      )}
    </AppShell>
  );
}

function ActionCard({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-tg-bg-section p-4 shadow-lg shadow-black/20 ring-1 ring-inset ring-white/[0.04] transition-all duration-150 active:scale-[0.99] active:shadow-md active:shadow-black/15"
    >
      <div className="flex items-center gap-4">
        <div
          className="shrink-0 w-11 h-11 rounded-2xl bg-tg-bg-secondary flex items-center justify-center text-xl"
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium tracking-tight">{title}</div>
          <div className="text-sm text-tg-text-hint">{subtitle}</div>
        </div>
        <div className="text-tg-text-hint" aria-hidden>
          →
        </div>
      </div>
    </Link>
  );
}
