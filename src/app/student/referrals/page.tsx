"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ru } from "@/lib/i18n";

interface ReferralsData {
  token: string;
  url: string;
  attributed_count: number;
  paid_count: number;
}

// Mirrors the discriminator in /api/student/summary's response. Only used
// to gate the referral UI behind "trial has ended".
type StatusKind =
  | "trial"
  | "trial_ending"
  | "active"
  | "renewing_soon"
  | "trial_expired"
  | "lapsed"
  | "payment_failed"
  | "frozen";

export default function ReferralsPage() {
  return (
    <AppShell title={ru.student.referrals.pageTitle} back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.student.referrals.studentsOnly}
            </div>
          );
        }
        return <Body jwt={jwt} />;
      }}
    </AppShell>
  );
}

function Body({ jwt }: { jwt: string }) {
  const [data, setData] = useState<ReferralsData | null>(null);
  // null while loading, "locked" before trial ends, "open" once trial is over.
  const [gate, setGate] = useState<"loading" | "locked" | "open" | "disabled">("loading");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/referrals", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const json = (await r.json()) as ReferralsData | { enabled: false };
    if ("enabled" in json && json.enabled === false) {
      setGate("disabled");
      return;
    }
    setData(json as ReferralsData);
  }, [jwt]);

  // Independent fetch of the subscription summary purely for the gate.
  // Referrals open AFTER the trial ends (any kind except trial / trial_ending),
  // regardless of pay status — same rule as MiniAppMenu.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/student/summary", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: { kind?: StatusKind } } | null) => {
        if (cancelled) return;
        const kind = d?.status?.kind ?? null;
        if (kind == null) {
          // Fail-open: if we can't fetch the gate, show the locked panel
          // rather than leak the referral link prematurely.
          setGate("locked");
        } else if (kind === "trial" || kind === "trial_ending") {
          setGate("locked");
        } else {
          setGate("open");
        }
      })
      .catch(() => {
        if (!cancelled) setGate("locked");
      });
    return () => {
      cancelled = true;
    };
  }, [jwt]);

  useEffect(() => {
    if (gate === "open") void load();
  }, [gate, load]);

  async function copyLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select and prompt — covers older WebViews without clipboard API.
      window.prompt(ru.student.referrals.manualCopyPrompt, data.url);
    }
  }

  function shareLink() {
    if (!data) return;
    if (typeof navigator.share === "function") {
      void navigator.share({
        title: ru.student.referrals.shareTitle,
        text: ru.student.referrals.shareText,
        url: data.url,
      });
    } else {
      void copyLink();
    }
  }

  if (gate === "loading") {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-tg-bg-secondary" />
        <div className="h-12 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  if (gate === "disabled") {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.referrals.unavailableHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.referrals.unavailableBody}
        </p>
      </div>
    );
  }

  if (gate === "locked") {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.referrals.lockedHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.referrals.lockedBody}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-tg-bg-secondary" />
        <div className="h-12 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.referrals.inviteFriendsHeader}
        </p>
        <p className="mt-2 text-sm text-tg-text-subtitle">
          {ru.student.referrals.friendsBodyPrefix}{" "}
          <span className="font-medium text-tg-text">{ru.student.referrals.bonusBold}</span>
          {ru.student.referrals.bodyCapPrefix}{" "}
          <span className="font-medium text-tg-text">{ru.student.referrals.bodyCapBold}</span>
          {ru.student.referrals.bodyCapSuffix}
        </p>

        <div className="mt-4 rounded-2xl bg-tg-bg-secondary p-3">
          <div className="text-[11px] uppercase tracking-wider text-tg-text-hint">
            {ru.student.referrals.linkLabel}
          </div>
          <div className="mt-1 break-all text-sm font-mono">{data.url}</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="h-10 rounded-2xl bg-tg-bg-secondary text-sm font-semibold transition-transform active:scale-[0.99]"
          >
            {copied ? ru.student.referrals.copiedButton : ru.student.referrals.copyButton}
          </button>
          <button
            type="button"
            onClick={shareLink}
            className="h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99]"
          >
            {ru.student.referrals.shareButton}
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-tg-bg-section p-5">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">{ru.student.referrals.statsHeader}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <Stat label={ru.student.referrals.statAttributed} value={data.attributed_count} />
          <Stat label={ru.student.referrals.statPaid} value={data.paid_count} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-tg-bg-secondary p-4">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-tg-text-hint">{label}</div>
    </div>
  );
}
