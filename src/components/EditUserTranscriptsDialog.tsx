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

  useEffect(() => {
    if (open) {
      setTranscripts(initialTranscripts);
      setTranslation(initialTranslation);
      setError(null);
    }
  }, [open, initialTranscripts, initialTranslation]);

  if (!open) return null;

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

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={transcripts}
            onChange={(e) => setTranscripts(e.target.checked)}
            className="w-5 h-5 accent-tg-button"
          />
          <span>{ru.admin.userTranscripts.transcriptsLabel}</span>
        </label>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={translation}
            onChange={(e) => setTranslation(e.target.checked)}
            disabled={!transcripts}
            className="w-5 h-5 accent-tg-button disabled:opacity-40"
          />
          <span className={transcripts ? "" : "text-tg-text-hint"}>
            {ru.admin.userTranscripts.translationLabel}
          </span>
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
