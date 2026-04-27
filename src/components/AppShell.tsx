"use client";
import type { ReactNode } from "react";
import { useInitDataAuth } from "@/hooks/useInitDataAuth";

export interface AppCtx {
  jwt: string;
  role: string;
  userId: number;
  name: string | null;
}

export function AppShell({ children }: { children: (ctx: AppCtx) => ReactNode }) {
  const status = useInitDataAuth();
  return (
    <main className="min-h-screen p-4">
      {status.state === "loading" && <p>Загрузка…</p>}
      {status.state === "no-tg" && <p>Открой эту страницу через Telegram.</p>}
      {status.state === "error" && (
        <p className="text-red-600">Ошибка авторизации: {status.message}</p>
      )}
      {status.state === "ok" &&
        children({
          jwt: status.jwt,
          role: status.user.role,
          userId: status.user.id,
          name: status.user.name,
        })}
    </main>
  );
}
