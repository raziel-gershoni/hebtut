"use client";
import { useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { ru } from "@/lib/i18n";

export interface SubscriptionInfo {
  status:
    | "trial"
    | "active"
    | "trial_expired"
    | "lapsed"
    | "payment_failed"
    | "frozen";
  trial_ends_at: string;
  current_period_ends_at: string | null;
  frozen_until: string | null;
}

interface Props {
  open: boolean;
  jwt: string;
  userId: number;
  userName: string;
  subscription: SubscriptionInfo | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

const QUICK_GRANTS = [30, 90, 365] as const;

export function SubscriptionDialog({
  open,
  jwt,
  userId,
  userName,
  subscription,
  onClose,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState<string>("");
  const [showCustom, setShowCustom] = useState(false);
  const [confirming, setConfirming] = useState<"reset_trial" | "lapse" | null>(null);

  if (!open) return null;

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/users/${userId}/subscription`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.admin.subscription.patchError);
      return false;
    }
    await onChanged();
    return true;
  }

  async function grant(days: number) {
    const ok = await patch({ action: "grant_days", days });
    if (ok) onClose();
  }

  async function grantCustom() {
    const days = Number(customDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError(ru.admin.subscription.customRangeError);
      return;
    }
    await grant(days);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
        <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up">
          <h2 className="font-semibold tracking-tight mb-1">{ru.admin.subscription.dialogTitle}</h2>
          <p className="text-xs text-tg-text-hint mb-3 truncate">{userName}</p>

          <CurrentState subscription={subscription} />

          <div className="mt-4 space-y-3">
            <p className="text-xs uppercase tracking-widest text-tg-text-hint">
              {ru.admin.subscription.activateHeader}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_GRANTS.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={busy}
                  onClick={() => void grant(days)}
                  className="h-11 rounded-xl bg-tg-bg-secondary text-tg-text text-sm font-semibold tabular-nums transition-transform active:scale-95 disabled:opacity-50"
                >
                  {days === 365
                    ? ru.admin.subscription.quickGrantYear
                    : ru.admin.subscription.quickGrantDays(days)}
                </button>
              ))}
            </div>
            {showCustom ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder={ru.admin.subscription.customDaysPlaceholder}
                  className="flex-1 h-11 px-3 rounded-xl bg-tg-bg-secondary text-tg-text tabular-nums outline-none focus:ring-2 focus:ring-tg-button/40"
                />
                <button
                  type="button"
                  disabled={busy || !customDays}
                  onClick={() => void grantCustom()}
                  className="h-11 px-4 rounded-xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
                >
                  {busy ? <Spinner /> : ru.admin.subscription.activateButton}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="text-xs text-tg-text-link"
              >
                {ru.admin.subscription.showCustomLink}
              </button>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-tg-text-hint/15 space-y-2">
            <p className="text-xs uppercase tracking-widest text-tg-text-hint">{ru.admin.subscription.dangerHeader}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming("reset_trial")}
              className="w-full h-10 rounded-xl bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
            >
              {ru.admin.subscription.resetTrialButton}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming("lapse")}
              className="w-full h-10 rounded-xl bg-tg-text-destructive/10 text-tg-text-destructive text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
            >
              {ru.admin.subscription.lapseButton}
            </button>
          </div>

          {error && <div className="mt-3 text-xs text-tg-text-destructive">{error}</div>}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
            >
              {ru.admin.subscription.closeButton}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming === "reset_trial"}
        title={ru.admin.subscription.resetConfirmTitle}
        body={ru.admin.subscription.resetConfirmBody}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          await patch({ action: "reset_trial" });
          setConfirming(null);
          onClose();
        }}
      />
      <ConfirmDialog
        open={confirming === "lapse"}
        title={ru.admin.subscription.lapseConfirmTitle}
        body={ru.admin.subscription.lapseConfirmBody}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          await patch({ action: "lapse" });
          setConfirming(null);
          onClose();
        }}
      />
    </>
  );
}

function CurrentState({ subscription }: { subscription: SubscriptionInfo | null }) {
  if (!subscription) {
    return (
      <div className="rounded-xl bg-tg-bg-secondary p-3 text-sm text-tg-text-hint">
        {ru.admin.subscription.noData}
      </div>
    );
  }
  const { status } = subscription;
  return (
    <div className="rounded-xl bg-tg-bg-secondary p-3 text-sm">
      <span className="text-tg-text-hint">{ru.admin.subscription.currentPrefix} </span>
      <span className="font-medium">{summary(subscription)}</span>
      <div className="mt-1 text-xs text-tg-text-hint">{detail(subscription)}</div>
      {status === "frozen" && subscription.frozen_until && (
        <div className="mt-1 text-xs text-tg-text-hint">
          {ru.admin.subscription.frozenUntil(fmtDate(subscription.frozen_until))}
        </div>
      )}
    </div>
  );
}

function summary(s: SubscriptionInfo): string {
  switch (s.status) {
    case "trial":
      return ru.admin.subscription.summary.trial;
    case "active":
      return ru.admin.subscription.summary.active;
    case "trial_expired":
      return ru.admin.subscription.summary.trialExpired;
    case "lapsed":
      return ru.admin.subscription.summary.lapsed;
    case "payment_failed":
      return ru.admin.subscription.summary.paymentFailed;
    case "frozen":
      return ru.admin.subscription.summary.frozen;
  }
}

function detail(s: SubscriptionInfo): string {
  switch (s.status) {
    case "trial":
      return ru.admin.subscription.detail.trialUntil(fmtDate(s.trial_ends_at));
    case "active":
      return s.current_period_ends_at
        ? ru.admin.subscription.detail.activeUntil(fmtDate(s.current_period_ends_at))
        : ru.admin.subscription.detail.activeNoPeriod;
    case "trial_expired":
      return ru.admin.subscription.detail.trialExpiredOn(fmtDate(s.trial_ends_at));
    case "lapsed":
      return s.current_period_ends_at
        ? ru.admin.subscription.detail.lapsedOn(fmtDate(s.current_period_ends_at))
        : ru.admin.subscription.detail.lapsedNoPeriod;
    case "payment_failed":
      return ru.admin.subscription.detail.paymentFailed;
    case "frozen":
      return s.current_period_ends_at
        ? ru.admin.subscription.detail.frozenPeriodUntil(fmtDate(s.current_period_ends_at))
        : ru.admin.subscription.detail.frozenNoPeriod;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
