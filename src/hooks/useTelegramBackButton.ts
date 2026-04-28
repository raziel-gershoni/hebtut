"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Drives Telegram's native Mini App BackButton: shows it while the calling
 * component is mounted (with a `target` set) and pushes that route on tap.
 * No-op outside of Telegram (regular browser dev), so the AppShell remains
 * usable in both contexts.
 */
export function useTelegramBackButton(target: string | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (!target) return;
    const btn = window.Telegram?.WebApp?.BackButton;
    if (!btn) return;
    const onClick = () => router.push(target);
    btn.show();
    btn.onClick(onClick);
    return () => {
      btn.offClick(onClick);
      btn.hide();
    };
  }, [target, router]);
}
