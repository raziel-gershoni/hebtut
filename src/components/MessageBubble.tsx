"use client";
import { useState } from "react";

type Msg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  created_at: string;
};

interface MessageBubbleProps {
  msg: Msg;
  jwt: string;
  onReply?: (messageId: number) => Promise<{ ok: boolean; reason?: string }>;
  replyDisabledReason?: string | null;
}

export function MessageBubble({ msg, jwt, onReply, replyDisabledReason }: MessageBubbleProps) {
  const min = Math.floor(msg.duration / 60);
  const sec = (msg.duration % 60).toString().padStart(2, "0");
  const isIn = msg.direction === "in";
  const align = isIn ? "justify-start" : "justify-end";
  const bubbleBase =
    "max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 my-1 transition-colors animate-fade-in";
  const bubble = isIn
    ? "bg-tg-bg-secondary border-l-2 border-tg-text-accent/40"
    : "bg-tg-button/10 border-r-2 border-tg-button/60";
  const src = `/api/media/${msg.id}?token=${encodeURIComponent(jwt)}`;
  const time = new Date(msg.created_at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleReply() {
    if (!onReply) return;
    setBusy(true);
    setFeedback(null);
    try {
      const r = await onReply(msg.id);
      if (r.ok) {
        setFeedback("✓ Свайпни по приглашению в чате");
      } else if (r.reason === "taken-by-other") {
        setFeedback("Берёт другой преподаватель");
      } else {
        setFeedback(`Ошибка: ${r.reason ?? "неизвестная"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex ${align}`}>
      <div className={`${bubbleBase} ${bubble}`}>
        <div className="text-[11px] uppercase tracking-wider text-tg-text-hint mb-1.5 flex items-center gap-2">
          <span>{isIn ? "Ученик" : "Преподаватель"}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {min}:{sec}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{time}</span>
        </div>
        {msg.kind === "voice" ? (
          <audio controls preload="none" src={src} className="w-full" />
        ) : (
          <video
            controls
            preload="none"
            playsInline
            className="rounded-xl max-w-full"
            src={src}
          />
        )}
        {isIn && onReply && (
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !!replyDisabledReason}
              onClick={() => void handleReply()}
              className="text-xs font-medium tracking-tight text-tg-text-link disabled:text-tg-text-hint disabled:cursor-not-allowed"
            >
              {busy ? "…" : "Ответить"}
            </button>
            {replyDisabledReason && (
              <span className="text-xs text-tg-text-hint">{replyDisabledReason}</span>
            )}
            {feedback && !replyDisabledReason && (
              <span className="text-xs text-tg-text-hint">{feedback}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
