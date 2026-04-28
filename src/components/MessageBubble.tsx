"use client";
import { useState } from "react";
import { formatDuration } from "@/lib/i18n";

export type ThreadMsg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  status?: string;
  reply_to_id?: number | null;
  created_at: string;
};

interface MessageBubbleProps {
  msg: ThreadMsg;
  jwt: string;
  /** Original message this bubble is a reply to, if any. */
  replyTo?: ThreadMsg | null;
  onReply?: (messageId: number) => Promise<{ ok: boolean; reason?: string }>;
  replyDisabledReason?: string | null;
}

function scrollToMessage(id: number) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Brief accent ring so the user sees what we scrolled to.
  el.classList.add("ring-2", "ring-tg-text-accent/40");
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-tg-text-accent/40");
  }, 1500);
}

export function MessageBubble({
  msg,
  jwt,
  replyTo,
  onReply,
  replyDisabledReason,
}: MessageBubbleProps) {
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
    <div id={`msg-${msg.id}`} className={`flex ${align} scroll-mt-16 rounded-2xl`}>
      <div className={`${bubbleBase} ${bubble}`}>
        <div className="text-[11px] uppercase tracking-wider text-tg-text-hint mb-1.5 flex items-center gap-2">
          <span>{isIn ? "Ученик" : "Преподаватель"}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDuration(msg.duration)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{time}</span>
        </div>

        {replyTo && (
          <button
            type="button"
            onClick={() => scrollToMessage(replyTo.id)}
            className="w-full text-left mb-2 rounded-xl bg-tg-bg/60 border-l-2 border-tg-text-accent/40 px-2.5 py-1.5 text-[11px] text-tg-text-hint transition-colors active:bg-tg-bg-secondary"
            aria-label="Перейти к исходному сообщению"
          >
            <span className="uppercase tracking-wider">
              {replyTo.direction === "in" ? "Ученик" : "Преподаватель"}
            </span>
            <span className="mx-1.5" aria-hidden>·</span>
            <span aria-hidden>{replyTo.kind === "voice" ? "🎙️" : "🟢"}</span>
            <span className="ml-1 tabular-nums">{formatDuration(replyTo.duration)}</span>
          </button>
        )}

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
