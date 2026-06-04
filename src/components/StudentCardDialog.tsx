"use client";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import type { SubscriptionStatus } from "@/types/database";

interface TagDictEntry {
  id: number;
  name: string;
  slug: string;
}

interface StatusInfo {
  kind: SubscriptionStatus;
  trial_ends_at: string;
  current_period_ends_at: string | null;
  frozen_until: string | null;
}

type Origin =
  | { kind: "direct" }
  | { kind: "referral"; referrer: { handle: string } }
  | { kind: "source"; source: { label: string; slug: string } };

interface CardResponse {
  status: StatusInfo | null;
  origin: Origin;
  tags: { dictionary: TagDictEntry[]; assigned: number[] };
}

/**
 * Tutor-facing "card" for a student. Opened from the chat header.
 * Bundles subscription status, acquisition origin, and tag assignments
 * via /api/users/[id]/card. Toggling a tag chip PUTs to /tags.
 *
 * Auth: admin OR the teacher linked to this student. Same gate as the
 * thread itself.
 */
export function StudentCardDialog({
  open,
  jwt,
  studentId,
  studentLabel,
  onClose,
}: {
  open: boolean;
  jwt: string;
  studentId: number;
  studentLabel: string;
  onClose: () => void;
}) {
  const [card, setCard] = useState<CardResponse | null>(null);
  const [assigned, setAssigned] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/users/${studentId}/card`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        setError(ru.inbox.studentCard.loadError);
        return;
      }
      const d = (await r.json()) as CardResponse;
      setCard(d);
      setAssigned(new Set(d.tags.assigned));
    } catch {
      setError(ru.inbox.studentCard.loadError);
    }
  }, [jwt, studentId]);

  useEffect(() => {
    if (!open) return;
    setCard(null);
    setAssigned(null);
    void load();
  }, [open, load]);

  async function toggle(tagId: number) {
    if (busy || assigned === null) return;
    const previous = assigned;
    const next = new Set(assigned);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setAssigned(next);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/users/${studentId}/tags`, {
        method: "PUT",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tagIds: Array.from(next) }),
      });
      if (!r.ok) {
        setError(ru.inbox.studentCard.saveError);
        setAssigned(previous);
      }
    } catch {
      setError(ru.inbox.studentCard.saveError);
      setAssigned(previous);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
        <h2 className="font-semibold tracking-tight mb-1">
          {ru.inbox.studentCard.dialogTitle}
        </h2>
        <div className="text-sm text-tg-text-subtitle mb-4 truncate">{studentLabel}</div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-5">
          {card === null || assigned === null ? (
            <div className="py-6 text-center"><Spinner /></div>
          ) : (
            <>
              {card.status && (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-tg-text-hint mb-2">
                    {ru.inbox.studentCard.statusHeading}
                  </h3>
                  <StatusChip status={card.status} />
                </section>
              )}

              <section>
                <h3 className="text-xs uppercase tracking-wider text-tg-text-hint mb-2">
                  {ru.inbox.studentCard.originHeading}
                </h3>
                <p className="text-sm">{originText(card.origin)}</p>
              </section>

              <section>
                <h3 className="text-xs uppercase tracking-wider text-tg-text-hint mb-2">
                  {ru.inbox.studentCard.tagsHeading}
                </h3>
                {card.tags.dictionary.length === 0 ? (
                  <div className="text-sm text-tg-text-hint italic">
                    {ru.inbox.studentCard.tagsEmptyDictionary}
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-tg-text-hint mb-3 leading-snug">
                      {ru.inbox.studentCard.tagsHint}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {card.tags.dictionary.map((tag) => {
                        const on = assigned.has(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void toggle(tag.id)}
                            className={`inline-flex items-center px-3 h-8 rounded-full text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${
                              on
                                ? "bg-tg-button text-tg-button-text"
                                : "bg-tg-bg-secondary text-tg-text"
                            }`}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-tg-text-destructive">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95"
          >
            {ru.inbox.studentCard.closeButton}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function originText(o: Origin): string {
  switch (o.kind) {
    case "direct":
      return ru.inbox.studentCard.originDirect;
    case "referral":
      return ru.inbox.studentCard.originReferral(o.referrer.handle);
    case "source":
      return ru.inbox.studentCard.originSource(o.source.label);
  }
}

function StatusChip({ status }: { status: StatusInfo }) {
  const labels = ru.inbox.studentCard.statusLabels;
  const tone = (() => {
    switch (status.kind) {
      case "queued":
        return "bg-tg-bg-secondary text-tg-text-subtitle";
      case "trial":
        return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
      case "active":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
      case "frozen":
        return "bg-tg-bg-secondary text-tg-text-hint";
      case "trial_expired":
      case "lapsed":
      case "payment_failed":
        return "bg-tg-text-destructive/10 text-tg-text-destructive";
    }
  })();
  const text = (() => {
    switch (status.kind) {
      case "queued":
        return labels.queued;
      case "trial":
        return labels.trial(fmtDate(status.trial_ends_at));
      case "active":
        return status.current_period_ends_at
          ? labels.active(fmtDate(status.current_period_ends_at))
          : labels.activeNoPeriod;
      case "trial_expired":
        return labels.trial_expired;
      case "lapsed":
        return labels.lapsed;
      case "payment_failed":
        return labels.payment_failed;
      case "frozen":
        return status.frozen_until ? labels.frozen(fmtDate(status.frozen_until)) : labels.frozenNoDate;
    }
  })();
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium tabular-nums ${tone}`}
    >
      {text}
    </span>
  );
}
