"use client";
import Link from "next/link";

interface MenuItem {
  href: string;
  title: string;
  subtitle: string;
  icon: string;
}

const ITEMS: MenuItem[] = [
  {
    href: "/feedback",
    title: "Поддержка",
    subtitle: "Связаться с админом или ответить на видео-просьбу",
    icon: "💬",
  },
  {
    href: "/student/referrals",
    title: "Рефералы",
    subtitle: "Пригласи друга — оба получите +30 дней",
    icon: "🎁",
  },
  {
    href: "/student/freeze",
    title: "Заморозка",
    subtitle: "Поставить практику на паузу до 3 дней в месяц",
    icon: "❄️",
  },
  {
    href: "/student/response-window",
    title: "Время ответа",
    subtitle: "Когда тренеру можно начинать диалог",
    icon: "🕒",
  },
];

export function MiniAppMenu() {
  return (
    <div className="space-y-3">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="block rounded-2xl bg-tg-bg-section p-4 shadow-lg shadow-black/20 ring-1 ring-inset ring-white/[0.04] transition-all duration-150 active:scale-[0.99] active:shadow-md active:shadow-black/15"
        >
          <div className="flex items-center gap-4">
            <div
              className="shrink-0 w-11 h-11 rounded-2xl bg-tg-bg-secondary flex items-center justify-center text-xl"
              aria-hidden
            >
              {item.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium tracking-tight">{item.title}</div>
              <div className="text-sm text-tg-text-hint">{item.subtitle}</div>
            </div>
            <div className="text-tg-text-hint" aria-hidden>
              →
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
