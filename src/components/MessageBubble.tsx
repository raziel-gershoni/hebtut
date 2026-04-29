"use client";
import { useRef, useState } from "react";
import { formatDuration } from "@/lib/i18n";
import { Spinner } from "./Spinner";

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
        // Mirror the inbox claim flow: close the Mini App so the prompt
        // landing in the teacher's TG chat is visible.
        window.Telegram?.WebApp?.close?.();
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
          <VoicePlayer src={src} totalSeconds={msg.duration} />
        ) : (
          <VideoNote src={src} />
        )}

        {isIn && onReply && (
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !!replyDisabledReason}
              onClick={() => void handleReply()}
              aria-busy={busy}
              className="inline-flex items-center gap-1.5 text-xs font-medium tracking-tight text-tg-text-link disabled:text-tg-text-hint disabled:cursor-not-allowed"
            >
              {busy && <Spinner size={12} />}
              <span>Ответить</span>
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

/**
 * TG-style voice player: round play/pause + thin progress bar + duration.
 * Hidden <audio> drives it via refs.
 */
function VoicePlayer({ src, totalSeconds }: { src: string; totalSeconds: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      void a.play();
    }
  }

  const elapsedDisplay = playing
    ? formatDuration(Math.floor(current))
    : formatDuration(totalSeconds);
  const progress = Math.min(1, totalSeconds > 0 ? current / totalSeconds : 0);

  return (
    <div className="flex items-center gap-3 min-w-[12rem]">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className="shrink-0 w-10 h-10 rounded-full bg-tg-button text-tg-button-text flex items-center justify-center transition-transform active:scale-95"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <rect x="2" y="1" width="3.5" height="12" rx="1" />
            <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <path d="M3 1.5L12 7L3 12.5z" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-1 rounded-full bg-tg-bg/40 overflow-hidden">
          <div
            className="h-full bg-tg-text-accent transition-[width] duration-100 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-tg-text-hint">
          {elapsedDisplay}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      />
    </div>
  );
}

/**
 * TG-style video note: a circular clip with a translucent play overlay
 * when paused. Tap-to-toggle, native controls hidden.
 */
function VideoNote({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.pause();
    else void v.play();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? "Пауза" : "Воспроизвести"}
      className="relative block w-44 h-44 sm:w-48 sm:h-48 rounded-full overflow-hidden bg-black"
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <svg
            width="36"
            height="36"
            viewBox="0 0 14 14"
            fill="white"
            className="drop-shadow"
            aria-hidden
          >
            <path d="M3 1.5L12 7L3 12.5z" />
          </svg>
        </div>
      )}
    </button>
  );
}
