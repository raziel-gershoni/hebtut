"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function Home() {
  return (
    <AppShell>
      {({ role, name }) => (
        <>
          <h1 className="text-lg font-semibold">Привет, {name ?? "пользователь"}!</h1>
          <p className="text-sm text-gray-500 mt-1">Роль: {role}</p>
          <nav className="mt-4 flex flex-col gap-2">
            {role === "admin" && (
              <Link className="underline" href="/admin">
                Админка
              </Link>
            )}
            {(role === "teacher" || role === "admin") && (
              <Link className="underline" href="/inbox">
                Входящие
              </Link>
            )}
            {role === "pending" && <p>Жди — администратор подключит тебя.</p>}
            {role === "student" && (
              <p>Запиши голосовое или круглое видео в чат с ботом.</p>
            )}
          </nav>
        </>
      )}
    </AppShell>
  );
}
