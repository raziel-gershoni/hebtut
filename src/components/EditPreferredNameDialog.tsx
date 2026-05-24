"use client";
import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { ru } from "@/lib/i18n";

const MAX_NAME_LENGTH = 50;

interface Props {
  open: boolean;
  jwt: string;
  userId: number;
  tgName: string | null;
  preferredName: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/**
 * Admin-side edit of users.preferred_name. Shows the TG-synced name as a
 * read-only reference (so the admin always knows the source of truth) and
 * an input pre-filled with the current preferred_name. Reset clears it →
 * peer surfaces fall back to the TG name.
 */
export function EditPreferredNameDialog({
  open,
  jwt,
  userId,
  tgName,
  preferredName,
  onClose,
  onSaved,
}: Props) {
  const [value, setValue] = useState(preferredName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Re-seed the input every time the dialog opens against a (possibly)
  // different user.
  useEffect(() => {
    if (open) {
      setValue(preferredName ?? "");
      setError(null);
    }
  }, [open, preferredName]);

  if (!open) return null;

  const trimmed = value.trim();
  const validNew =
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    trimmed.replace(/\s+/g, " ") !== (preferredName ?? "");

  async function patch(next: string | null) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/users/${userId}/preferred-name`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preferred_name: next }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.admin.editName.saveError);
      return false;
    }
    await onSaved();
    return true;
  }

  async function save() {
    const ok = await patch(trimmed.replace(/\s+/g, " "));
    if (ok) onClose();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
        <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up space-y-3">
          <h2 className="font-semibold tracking-tight">{ru.admin.editName.dialogTitle}</h2>

          <div className="rounded-xl bg-tg-bg-secondary p-3 text-xs">
            <span className="text-tg-text-hint">{ru.admin.editName.tgLabel} </span>
            <span className="font-medium text-tg-text">{tgName ?? "—"}</span>
          </div>

          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
              {ru.admin.editName.preferredLabel}
            </span>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={tgName ?? ru.admin.editName.inputPlaceholderFallback}
              maxLength={MAX_NAME_LENGTH}
              className="w-full h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
            />
            <span className="block text-[11px] text-tg-text-hint mt-1">
              {ru.admin.editName.helpText}
            </span>
          </label>

          {error && <div className="text-xs text-tg-text-destructive">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            {preferredName != null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingReset(true)}
                className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text-destructive text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
              >
                {ru.admin.editName.resetButton}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50"
            >
              {ru.admin.editName.cancelButton}
            </button>
            <button
              type="button"
              disabled={busy || !validNew}
              onClick={() => void save()}
              aria-busy={busy}
              className="h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95 disabled:opacity-50 inline-flex items-center justify-center min-w-[6rem]"
            >
              {busy ? <Spinner /> : ru.admin.editName.saveButton}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingReset}
        title={ru.admin.editName.resetConfirmTitle}
        body={ru.admin.editName.resetConfirmBody}
        onCancel={() => setConfirmingReset(false)}
        onConfirm={async () => {
          const ok = await patch(null);
          setConfirmingReset(false);
          if (ok) onClose();
        }}
      />
    </>
  );
}
