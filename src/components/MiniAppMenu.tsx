"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n";

interface MenuItem {
  href: string;
  title: string;
  subtitle: string;
  icon: string;
}

const ITEMS: MenuItem[] = [
  {
    href: "/feedback",
    title: ru.student.menu.items.feedback.title,
    subtitle: ru.student.menu.items.feedback.subtitle,
    icon: "💬",
  },
  {
    href: "/student/referrals",
    title: ru.student.menu.items.referrals.title,
    subtitle: ru.student.menu.items.referrals.subtitle,
    icon: "🎁",
  },
  {
    href: "/student/freeze",
    title: ru.student.menu.items.freeze.title,
    subtitle: ru.student.menu.items.freeze.subtitle,
    icon: "❄️",
  },
  {
    href: "/student/response-window",
    title: ru.student.menu.items.responseWindow.title,
    subtitle: ru.student.menu.items.responseWindow.subtitle,
    icon: "🕒",
  },
  {
    href: "/student/transcripts",
    title: ru.student.menu.items.transcripts.title,
    subtitle: ru.student.menu.items.transcripts.subtitle,
    icon: "📝",
  },
];

// Minimal status shape — only the discriminator matters for gating.
type StatusKind =
  | "trial"
  | "trial_ending"
  | "active"
  | "renewing_soon"
  | "trial_expired"
  | "lapsed"
  | "payment_failed"
  | "frozen";

/**
 * Per-item visibility rules driven by subscription status:
 *   /student/freeze    — only when status is `active` (server also enforces).
 *   /student/referrals — only AFTER the trial ends (any kind except trial /
 *                        trial_ending), regardless of pay status.
 *
 * While the status fetch is pending we hide the gated items — better
 * to under-show briefly than flash-then-hide. The /feedback and
 * /student/response-window items have no gate; they're always visible.
 */
function isItemVisible(
  href: string,
  kind: StatusKind | null,
  referralsEnabled: boolean,
): boolean {
  switch (href) {
    case "/student/freeze":
      return kind === "active";
    case "/student/referrals":
      return (
        referralsEnabled && kind != null && kind !== "trial" && kind !== "trial_ending"
      );
    default:
      return true;
  }
}

export function MiniAppMenu({ jwt }: { jwt: string }) {
  const [kind, setKind] = useState<StatusKind | null>(null);
  const [referralsEnabled, setReferralsEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/student/summary", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: { status?: { kind?: StatusKind }; referrals_enabled?: boolean } | null,
        ) => {
          if (cancelled) return;
          if (d?.status?.kind) setKind(d.status.kind);
          setReferralsEnabled(d?.referrals_enabled === true);
        },
      )
      .catch(() => {
        // Network hiccup — gated items stay hidden, ungated stay visible.
      });
    return () => {
      cancelled = true;
    };
  }, [jwt]);

  const visibleItems = ITEMS.filter((it) => isItemVisible(it.href, kind, referralsEnabled));

  return (
    <div className="space-y-3">
      {visibleItems.map((item) => (
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
