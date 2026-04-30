"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const ROLE_LABEL: Record<string, string> = {
  pending: "ждём подтверждения",
  student: "ученик",
  teacher: "тренер",
};

export default function Home() {
  return (
    <AppShell>
      {({ role, isAdmin, name }) => (
        <div className="space-y-6">
          <section className="rounded-2xl bg-tg-bg-section p-5">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-widest text-tg-text-hint">
                {ROLE_LABEL[role] ?? role}
              </p>
              {isAdmin && (
                <span className="text-[10px] font-semibold tracking-widest px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400">
                  АДМИН
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Привет, {name ?? "пользователь"}!
            </h1>
            {role === "pending" && !isAdmin && (
              <p className="mt-3 text-sm text-tg-text-subtitle">
                Жди — администратор подключит тебя в ближайшее время.
              </p>
            )}
            {role === "student" && (
              <p className="mt-3 text-sm text-tg-text-subtitle">
                Запиши голосовое или круглое видео в чат с ботом — тренер ответит вам.
              </p>
            )}
            {isAdmin && role !== "teacher" && (
              <p className="mt-3 text-sm text-tg-text-subtitle">
                Ты администратор. Если хочешь ещё и принимать ответы — назначь себе роль «teacher» в админке.
              </p>
            )}
          </section>

          {(role === "teacher" || isAdmin) && (
            <ActionCard
              href="/inbox"
              title="Входящие"
              subtitle={
                role === "teacher"
                  ? "Сообщения от твоих учеников"
                  : "Просмотр всех диалогов (только чтение)"
              }
              icon="📥"
            />
          )}

          {isAdmin && (
            <ActionCard
              href="/admin"
              title="Админка"
              subtitle="Пользователи и связи ученик↔тренер"
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
