"use client";
import { useEffect, useState } from "react";

export type SessionUser = {
  id: number;
  role: string;
  is_admin: boolean;
  name: string | null;
};
export type AuthStatus =
  | { state: "loading" }
  | { state: "no-tg" }
  | { state: "error"; message: string }
  | { state: "ok"; jwt: string; user: SessionUser };

export function useInitDataAuth(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ state: "loading" });

  useEffect(() => {
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (!tg) {
      setStatus({ state: "no-tg" });
      return;
    }
    tg.ready();
    tg.expand();
    const initData = tg.initData ?? "";
    if (!initData) {
      setStatus({ state: "error", message: "missing initData" });
      return;
    }
    fetch("/api/auth/session", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as { jwt: string; user: SessionUser };
      })
      .then((d) => setStatus({ state: "ok", jwt: d.jwt, user: d.user }))
      .catch((e: Error) => setStatus({ state: "error", message: e.message }));
  }, []);

  return status;
}
