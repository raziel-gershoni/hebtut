"use client";
import { ru } from "@/lib/i18n";
import { useState } from "react";
import { Spinner } from "./Spinner";

export function ClaimButton({
  jwt,
  messageId,
  onClaimed,
}: {
  jwt: string;
  messageId: number;
  onClaimed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      className="inline-flex items-center justify-center min-h-9 h-9 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium tracking-tight shadow-sm transition-transform active:scale-95 disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch("/api/replies/start", {
            method: "POST",
            cache: "no-store",
            headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messageId }),
          });
          if (r.ok) {
            onClaimed();
            window.Telegram?.WebApp?.close?.();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : ru.inbox.claim.replyButton}
    </button>
  );
}
