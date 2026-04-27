"use client";
import { useState } from "react";

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
      disabled={busy}
      className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch("/api/claim", {
            method: "POST",
            headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messageId }),
          });
          if (r.ok) {
            onClaimed();
            // Close the mini-app so the teacher sees the prompt land in their TG chat.
            window.Telegram?.WebApp?.close?.();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      Ответить
    </button>
  );
}
