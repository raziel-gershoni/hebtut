"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ru } from "@/lib/i18n";

interface FreezeData {
  remaining_days: number;
  budget_days: number;
  status: string | null;
  frozen_until_iso: string | null;
  current_period_ends_at_iso: string | null;
}

export default function FreezePage() {
  return (
    <AppShell title={ru.student.freeze.pageTitle} back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.student.freeze.studentsOnly}
            </div>
          );
        }
        return <Body jwt={jwt} />;
      }}
    </AppShell>
  );
}

function Body({ jwt }: { jwt: string }) {
  const [data, setData] = useState<FreezeData | null>(null);
  const [pickedDays, setPickedDays] = useState<1 | 2 | 3 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/freeze", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    setData((await r.json()) as FreezeData);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    if (!pickedDays || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/student/freeze", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ days: pickedDays }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === "not_active"
          ? ru.student.freeze.errorNotActive
          : body.error === "budget_exceeded"
            ? ru.student.freeze.errorBudgetExceeded
            : ru.student.freeze.errorGeneric,
      );
      return;
    }
    setPickedDays(null);
    await load();
  }

  if (!data) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-32 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  // Gate: freeze is only meaningful for active subscribers. Server enforces
  // (returns error: "not_active") on the POST, but the page-level gate keeps
  // the picker out of sight entirely for trial / lapsed / payment_failed /
  // already-frozen statuses, matching the hidden menu entry.
  if (data.status !== "active") {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.freeze.lockedHeader}
        </p>
        {data.status === "frozen" ? (
          <>
            <p className="text-sm text-tg-text-subtitle">
              {ru.student.freeze.lockedFrozen(formatDate(data.frozen_until_iso))}
            </p>
            <p className="text-sm text-tg-text-subtitle">
              {ru.student.freeze.lockedFrozenHint}
            </p>
          </>
        ) : (
          <p className="text-sm text-tg-text-subtitle">
            {ru.student.freeze.lockedNonActive}
          </p>
        )}
      </div>
    );
  }

  const allowedMax = Math.min(3, data.remaining_days);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.freeze.howItWorksHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.freeze.budgetLine(data.budget_days)}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.freeze.extendsLine}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.freeze.effectsNextDayLine}
        </p>
      </section>

      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-3">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.freeze.pickerHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.freeze.budgetSummary(data.remaining_days, data.budget_days)}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => {
            const allowed = n <= allowedMax;
            const picked = pickedDays === n;
            return (
              <button
                key={n}
                type="button"
                disabled={!allowed || busy}
                onClick={() => setPickedDays(n as 1 | 2 | 3)}
                className={`h-12 rounded-2xl text-sm font-semibold transition-all ${
                  picked
                    ? "bg-tg-button text-tg-button-text"
                    : "bg-tg-bg-secondary text-tg-text"
                } disabled:opacity-40`}
              >
                {n} {n === 1 ? ru.student.freeze.oneDay : ru.student.freeze.twoDays}
              </button>
            );
          })}
        </div>
        {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
        <button
          type="button"
          disabled={!pickedDays || busy || allowedMax === 0}
          onClick={() => void activate()}
          className="w-full h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? ru.student.freeze.activatingButton : ru.student.freeze.activateButton}
        </button>
      </section>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}
