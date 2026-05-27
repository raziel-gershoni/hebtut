"use client";
import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";

interface Props {
  open: boolean;
  jwt: string;
  userId: number;
  initialTranscripts: boolean;
  initialTranslation: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/**
 * Admin-side dialog for the per-user transcripts + translation toggles
 * on `subscriptions`. PATCHes /api/admin/users/[id]/transcripts.
 * Mirrors EditPreferredNameDialog's shape.
 */
export function EditUserTranscriptsDialog({
  open,
  jwt,
  userId,
  initialTranscripts,
  initialTranslation,
  onClose,
  onSaved,
}: Props) {
  const [transcripts, setTranscripts] = useState(initialTranscripts);
  const [translation, setTranslation] = useState(initialTranslation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the global toggles, fetched once per open. Lets us grey
  // out per-user checkboxes + show a "globally off" notice when the admin
  // has the feature disabled centrally. Effective delivery is global AND
  // per-user; admin can still save a preference for when global flips
  // back on.
  const [globals, setGlobals] = useState<{
    transcripts: boolean;
    translation: boolean;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setTranscripts(initialTranscripts);
      setTranslation(initialTranslation);
      setError(null);
      setGlobals(null);
      void fetch("/api/admin/settings", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (d: {
            settings?: {
              transcripts_enabled?: boolean;
              translation_enabled?: boolean;
            };
          } | null) => {
            if (d?.settings) {
              setGlobals({
                transcripts: d.settings.transcripts_enabled === true,
                translation: d.settings.translation_enabled === true,
              });
            }
          },
        )
        .catch(() => {
          // Treat as "globals on" — better to let the admin edit than to
          // grey out wrongly on a transient network failure.
        });
    }
  }, [open, initialTranscripts, initialTranslation, jwt]);

  if (!open) return null;

  const transcriptsLockedByGlobal = globals?.transcripts === false;
  const translationLockedByGlobal = globals?.translation === false;
  const translationDisabled = !transcripts || translationLockedByGlobal;

  const dirty =
    transcripts !== initialTranscripts || translation !== initialTranslation;

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/users/${userId}/transcripts`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcripts_enabled: transcripts,
        translation_enabled: translation,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.admin.userTranscripts.saveError);
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-4">
        <h2 className="font-semibold tracking-tight">
          {ru.admin.userTranscripts.dialogTitle}
        </h2>
        <p className="text-xs text-tg-text-hint">
          {ru.admin.userTranscripts.dialogHint}
        </p>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={transcripts}
            onChange={(e) => setTranscripts(e.target.checked)}
            disabled={transcriptsLockedByGlobal}
            className="mt-0.5 w-5 h-5 accent-tg-button disabled:opacity-40"
          />
          <div className={`min-w-0 flex-1 ${transcriptsLockedByGlobal ? "opacity-60" : ""}`}>
            <div>{ru.admin.userTranscripts.transcriptsLabel}</div>
            {transcriptsLockedByGlobal && (
              <div className="text-[11px] text-tg-text-hint mt-0.5 italic">
                {ru.admin.userTranscripts.globallyDisabledNotice}
              </div>
            )}
          </div>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={translation}
            onChange={(e) => setTranslation(e.target.checked)}
            disabled={translationDisabled}
            className="mt-0.5 w-5 h-5 accent-tg-button disabled:opacity-40"
          />
          <div className={`min-w-0 flex-1 ${translationDisabled ? "opacity-60" : ""}`}>
            <div>{ru.admin.userTranscripts.translationLabel}</div>
            {translationLockedByGlobal && (
              <div className="text-[11px] text-tg-text-hint mt-0.5 italic">
                {ru.admin.userTranscripts.globallyDisabledNotice}
              </div>
            )}
          </div>
        </label>

        {error && <div className="text-xs text-tg-text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
          >
            {ru.admin.userTranscripts.cancelButton}
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void save()}
            aria-busy={busy}
            className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
          >
            {busy ? <Spinner /> : ru.admin.userTranscripts.saveButton}
          </button>
        </div>
      </div>
    </div>
  );
}
