"use client";
import type { ReactNode } from "react";
import { useInitDataAuth } from "@/hooks/useInitDataAuth";
import { useTelegramBackButton } from "@/hooks/useTelegramBackButton";

export interface AppCtx {
  jwt: string;
  role: string;
  isAdmin: boolean;
  userId: number;
  name: string | null;
}

interface AppShellProps {
  title?: string;
  back?: string;
  children: (ctx: AppCtx) => ReactNode;
}

const ROLE_LABEL: Record<string, string> = {
  pending: "ожидание",
  student: "ученик",
  teacher: "преподаватель",
};

export function AppShell({ title, back, children }: AppShellProps) {
  const status = useInitDataAuth();
  // Drive TG's native back button. The visual back link below is gone;
  // TG renders its own native chevron in the platform's preferred place.
  useTelegramBackButton(back);

  return (
    <div className="min-h-screen flex flex-col">
      {title && (
        <header className="sticky top-0 z-10 bg-tg-bg-header/95 backdrop-blur supports-[backdrop-filter]:bg-tg-bg-header/80 border-b border-black/[0.04]">
          <div className="mx-auto max-w-2xl px-4 h-12 flex items-center gap-3">
            <h1 className="text-base font-semibold tracking-tight truncate">
              {title}
            </h1>
            {status.state === "ok" && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-tg-text-hint uppercase tracking-wider">
                  {ROLE_LABEL[status.user.role] ?? status.user.role}
                </span>
                {status.user.is_admin && (
                  <span className="text-[10px] font-semibold tracking-widest px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400">
                    АДМИН
                  </span>
                )}
              </div>
            )}
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 animate-fade-in">
        {status.state === "loading" && <SkeletonStack />}
        {status.state === "no-tg" && (
          <Notice tone="info">Открой эту страницу через Telegram.</Notice>
        )}
        {status.state === "error" && (
          <Notice tone="error">Ошибка авторизации: {status.message}</Notice>
        )}
        {status.state === "ok" &&
          children({
            jwt: status.jwt,
            role: status.user.role,
            isAdmin: status.user.is_admin,
            userId: status.user.id,
            name: status.user.name,
          })}
      </main>
    </div>
  );
}

function SkeletonStack() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-1/3 rounded bg-tg-bg-secondary" />
      <div className="h-20 rounded-2xl bg-tg-bg-secondary" />
      <div className="h-20 rounded-2xl bg-tg-bg-secondary" />
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-tg-text-destructive/25 text-tg-text-destructive"
      : "border-tg-text-hint/30 text-tg-text-subtitle";
  return (
    <div className={`rounded-2xl border ${cls} bg-tg-bg-section p-4 text-sm`}>{children}</div>
  );
}
