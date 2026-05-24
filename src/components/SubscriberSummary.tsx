"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDuration, isSingularDay, pluralDay, ru } from "@/lib/i18n";

type ApiStatus =
  | { kind: "trial"; daysLeft: number; endsAtIso: string }
  | { kind: "trial_ending"; daysLeft: 0 | 1; endsAtIso: string }
  | { kind: "active"; renewsInDays: number; endsAtIso: string }
  | { kind: "renewing_soon"; renewsInDays: 0 | 1 | 2; endsAtIso: string }
  | { kind: "trial_expired" }
  | { kind: "lapsed" }
  | { kind: "payment_failed" }
  | { kind: "frozen"; untilIso: string };

interface Summary {
  name: string;
  status: ApiStatus;
  practice: {
    used_seconds: number;
    remaining_seconds: number;
    daily_quota_seconds: number;
    reset_at_iso: string;
  };
  streak_days: number;
  motivation: { key: string; text: string };
  progress_metric: null | string;
  billing: { stars_enabled: boolean };
}

export function SubscriberSummary({ jwt }: { jwt: string }) {
  const [data, setData] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/summary", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    setData((await r.json()) as Summary);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [load]);

  if (!data) return <SkeletonCard />;

  return (
    <section className="rounded-2xl bg-tg-bg-section p-5 space-y-3">
      <StatusStrip status={data.status} />
      <div className="text-lg font-semibold tracking-tight">{data.name}</div>
      <MainLine status={data.status} practice={data.practice} />
      <ProgressBar
        used={data.practice.used_seconds}
        quota={data.practice.daily_quota_seconds}
        status={data.status}
      />
      {(data.streak_days > 0 || data.motivation.text) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {data.streak_days > 0 && <StreakChip days={data.streak_days} />}
          {data.motivation.text && (
            <span className="text-sm text-tg-text-subtitle">{data.motivation.text}</span>
          )}
        </div>
      )}
      <PayCTA status={data.status} jwt={jwt} starsEnabled={data.billing.stars_enabled} />
    </section>
  );
}

function SkeletonCard() {
  return (
    <section className="rounded-2xl bg-tg-bg-section p-5 animate-pulse space-y-3">
      <div className="h-3 w-32 rounded bg-tg-bg-secondary" />
      <div className="h-6 w-40 rounded bg-tg-bg-secondary" />
      <div className="h-4 w-3/4 rounded bg-tg-bg-secondary" />
      <div className="h-1.5 w-full rounded-full bg-tg-bg-secondary" />
    </section>
  );
}

/* -------------------------------------------------------------------------
 * StatusStrip — top sliver of the card. Maps to the spec's "Верхняя строка"
 * column. Colour signals urgency: amber for 'about to lapse', red for locked,
 * grey for steady-state info. 'active' steady-state has no strip per spec.
 * ----------------------------------------------------------------------- */
function StatusStrip({ status }: { status: ApiStatus }) {
  const text = stripText(status);
  if (!text) return null;
  const tone = stripTone(status);
  return (
    <p
      className={`text-xs uppercase tracking-widest ${
        tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : tone === "red"
            ? "text-tg-text-destructive"
            : "text-tg-text-hint"
      }`}
    >
      {text}
    </p>
  );
}

function stripText(s: ApiStatus): string | null {
  switch (s.kind) {
    case "trial":
      return ru.student.summary.strip.trial(
        s.daysLeft,
        pluralDay(s.daysLeft),
        isSingularDay(s.daysLeft) ? ru.student.summary.verbRemaining : ru.student.summary.verbRemainingPlural,
      );
    case "trial_ending":
      return s.daysLeft === 0
        ? ru.student.summary.strip.trialEndsTodayShort
        : ru.student.summary.strip.trialEndsTomorrowShort;
    case "active":
      return null;
    case "renewing_soon":
      return s.renewsInDays === 0
        ? ru.student.summary.strip.renewingToday
        : ru.student.summary.strip.renewingInDays(s.renewsInDays, pluralDay(s.renewsInDays));
    case "trial_expired":
      return ru.student.summary.strip.trialExpired;
    case "lapsed":
      return ru.student.summary.strip.lapsed;
    case "payment_failed":
      return ru.student.summary.strip.paymentFailed;
    case "frozen": {
      const d = new Date(s.untilIso);
      return ru.student.summary.strip.frozenUntil(
        d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      );
    }
  }
}

function stripTone(s: ApiStatus): "grey" | "amber" | "red" {
  if (s.kind === "trial_ending" || s.kind === "renewing_soon") return "amber";
  if (s.kind === "trial_expired" || s.kind === "lapsed" || s.kind === "payment_failed") {
    return "red";
  }
  return "grey";
}

/* -------------------------------------------------------------------------
 * MainLine — "Осталось X минут" / "Сегодня доступно 5 минут" / etc.
 * Mirrors the spec's "Основная строка" table. Locked states get a different
 * tone (red, no quota math).
 * ----------------------------------------------------------------------- */
function MainLine({
  status,
  practice,
}: {
  status: ApiStatus;
  practice: Summary["practice"];
}) {
  const locked =
    status.kind === "trial_expired" ||
    status.kind === "lapsed" ||
    status.kind === "payment_failed";
  if (locked) {
    return (
      <p className="text-tg-text-destructive">
        {ru.student.summary.practiceStopped}
      </p>
    );
  }
  if (status.kind === "frozen") {
    return <p className="text-tg-text-subtitle">{ru.student.summary.practiceFrozen}</p>;
  }
  if (practice.used_seconds < 60) {
    return (
      <p className="text-tg-text">
        {ru.student.summary.todayAvailable(formatDuration(practice.daily_quota_seconds))}
      </p>
    );
  }
  if (practice.remaining_seconds <= 0) {
    return <p className="text-tg-text">{ru.student.summary.todayClosed}</p>;
  }
  return (
    <p className="text-tg-text">
      {ru.student.summary.remainingToday(formatDuration(practice.remaining_seconds))}
    </p>
  );
}

function ProgressBar({
  used,
  quota,
  status,
}: {
  used: number;
  quota: number;
  status: ApiStatus;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(1, quota)) * 100));
  const locked =
    status.kind === "trial_expired" ||
    status.kind === "lapsed" ||
    status.kind === "payment_failed";
  // Locked / frozen → muted bar that doesn't fill, since the quota concept is paused.
  const bar = locked || status.kind === "frozen" ? "bg-tg-text-hint/40" : "bg-tg-text-accent";
  return (
    <div className="h-1.5 w-full rounded-full bg-tg-bg-secondary overflow-hidden">
      <div
        className={`h-full rounded-full ${bar} transition-all duration-300`}
        style={{ width: `${locked ? 100 : pct}%` }}
      />
    </div>
  );
}

function StreakChip({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
      {ru.student.summary.streakChip(days, pluralDay(days))}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * PayCTA — the "Оплатить — 30 дней" button. Visible only in states where
 * conversion is the next obvious step. Wave 1: button is decorative, points
 * at `/pay` placeholder. Wave 2 wires `openInvoice` via the BillingProvider.
 * ----------------------------------------------------------------------- */
function PayCTA({
  status,
  jwt,
  starsEnabled,
}: {
  status: ApiStatus;
  jwt: string;
  starsEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const visible =
    status.kind === "trial_ending" ||
    status.kind === "trial_expired" ||
    status.kind === "lapsed" ||
    status.kind === "payment_failed";
  if (!visible) return null;

  // Manual-billing variant: hide the Stars CTA entirely, route to /feedback
  // so the student can DM the admin to arrange payment out-of-band. No call
  // to /api/billing/invoice (the route also returns 503 in this state).
  if (!starsEnabled) {
    return (
      <Link
        href="/feedback"
        className="w-full inline-flex items-center justify-center h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold tracking-tight transition-transform active:scale-[0.99]"
      >
        {ru.student.summary.contactAdmin}
      </Link>
    );
  }

  const label =
    status.kind === "payment_failed"
      ? ru.student.summary.updatePayment
      : ru.student.summary.pay30Days;

  async function pay() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/billing/invoice", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!r.ok) {
        window.alert(ru.student.summary.payOpenError);
        return;
      }
      const { url } = (await r.json()) as { url: string };
      const tg = window.Telegram?.WebApp;
      if (tg?.openInvoice) {
        tg.openInvoice(url);
      } else {
        // Fallback for browser preview / non-TG contexts.
        window.open(url, "_blank");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void pay()}
      className="w-full inline-flex items-center justify-center h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold tracking-tight transition-transform active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? ru.student.summary.opening : label}
    </button>
  );
}
