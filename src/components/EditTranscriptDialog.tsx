"use client";
import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";

const MAX_TRANSCRIPT_LENGTH = 5000;

interface Props {
  open: boolean;
  jwt: string;
  messageId: number;
  currentText: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function EditTranscriptDialog({
  open,
  jwt,
  messageId,
  currentText,
  onClose,
  onSaved,
}: Props) {
  const [value, setValue] = useState(currentText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(currentText);
      setError(null);
    }
  }, [open, currentText]);

  if (!open) return null;

  const trimmed = value.trim();
  const validNew =
    trimmed.length > 0 &&
    trimmed.length <= MAX_TRANSCRIPT_LENGTH &&
    trimmed !== currentText.trim();

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/messages/${messageId}/transcript`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.inbox.message.transcriptSaveError);
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-3">
        <h2 className="font-semibold tracking-tight">
          {ru.inbox.message.transcriptDialogTitle}
        </h2>
        <p className="text-xs text-tg-text-hint">
          {ru.inbox.message.transcriptDialogHint}
        </p>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={MAX_TRANSCRIPT_LENGTH}
          rows={6}
          className="w-full px-3 py-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40 leading-snug resize-y min-h-[7rem]"
        />

        {error && <div className="text-xs text-tg-text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
          >
            {ru.inbox.message.transcriptCancelButton}
          </button>
          <button
            type="button"
            disabled={busy || !validNew}
            onClick={() => void save()}
            aria-busy={busy}
            className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
          >
            {busy ? <Spinner /> : ru.inbox.message.transcriptSaveButton}
          </button>
        </div>
      </div>
    </div>
  );
}
