"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const ROLE_LABEL: Record<string, string> = {
  pending: "ждём подтверждения",
  student: "ученик",
  teacher: "преподаватель",
  admin: "администратор",
};

export default function Home() {
  return (
    <AppShell>
      {({ role, name }) => (
        <div className="space-y-6">
          <section className="rounded-2xl bg-tg-bg-section p-5">
            <p className="text-xs uppercase tracking-widest text-tg-text-hint">
              {ROLE_LABEL[role] ?? role}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Привет, {name ?? "пользователь"}!
            </h1>
            {role === "pending" && (
              <p className="mt-3 text-sm text-tg-text-subtitle">
                Жди — администратор подключит тебя в ближайшее время.
              </p>
            )}
            {role === "student" && (
              <p className="mt-3 text-sm text-tg-text-subtitle">
                Запиши голосовое или круглое видео в чат с ботом — преподаватель ответит вам.
              </p>
            )}
          </section>

          {(role === "teacher" || role === "admin") && (
            <ActionCard
              href="/inbox"
              title="Входящие"
              subtitle="Сообщения от твоих учеников"
              icon="📥"
            />
          )}

          {role === "admin" && (
            <ActionCard
              href="/admin"
              title="Админка"
              subtitle="Пользователи и связи студент↔преподаватель"
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
      className="block rounded-2xl bg-tg-bg-section p-4 transition-transform active:scale-[0.99]"
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
