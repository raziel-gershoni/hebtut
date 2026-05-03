"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/i18n";
import { Spinner } from "./Spinner";
import { Avatar } from "./Avatar";
import type { SpeakerColorClasses } from "@/lib/speaker-color";
import { usePlaybackSpeed, formatSpeed } from "@/hooks/usePlaybackSpeed";

export type ThreadMsg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  status?: string;
  reply_to_id?: number | null;
  created_at: string;
};

export interface Speaker {
  name: string;
  /** Self/admin path: real TG photo URL. Mutually exclusive with emoji+bgClass. */
  avatarUrl?: string;
  /** Anonymous path: animal emoji on a colored circle. */
  emoji?: string;
  bgClass?: string;
}

interface MessageBubbleProps {
  msg: ThreadMsg;
  jwt: string;
  /** Who said this message. Drives the meta label and the side avatar. */
  speaker: Speaker;
  /** Color classes derived from the speaker's user_id. */
  speakerColors: SpeakerColorClasses;
  /** Original message this one replies to, if any. */
  replyTo?: ThreadMsg | null;
  replyToSpeaker?: Speaker | null;
  replyToSpeakerColors?: SpeakerColorClasses | null;
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
  speaker,
  speakerColors,
  replyTo,
  replyToSpeaker,
  replyToSpeakerColors,
  onReply,
  replyDisabledReason,
}: MessageBubbleProps) {
  const isIn = msg.direction === "in";
  const align = isIn ? "justify-start" : "justify-end";
  // Bubble cap: roomy on narrow phones (so the voice player's ~12rem min
  // width fits), then pull back hard on wider screens so the thread reads
  // as a conversation rather than a wall of text.
  const bubbleBase =
    "max-w-[85%] sm:max-w-[60%] md:max-w-[50%] rounded-2xl p-3 my-1 transition-colors animate-fade-in";
  const bubble = isIn
    ? `${speakerColors.bubbleBg} border-l-[3px] ${speakerColors.border}`
    : `${speakerColors.bubbleBg} border-r-[3px] ${speakerColors.border}`;
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
        // Mirror the inbox claim flow — close the Mini App so the prompt
        // landing in the teacher's TG chat is visible.
        window.Telegram?.WebApp?.close?.();
      } else if (r.reason === "taken-by-other") {
        setFeedback("Берёт другой тренер");
      } else {
        setFeedback(`Ошибка: ${r.reason ?? "неизвестная"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const speakerAvatar = (
    <Avatar
      size={32}
      name={speaker.name}
      imageUrl={speaker.avatarUrl}
      emoji={speaker.emoji}
      bgClass={speaker.bgClass}
    />
  );

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex ${align} items-start gap-2 scroll-mt-16 rounded-2xl`}
    >
      {isIn && <div className="shrink-0 mt-1.5">{speakerAvatar}</div>}
      <div className={`${bubbleBase} ${bubble}`}>
        <div className="text-[11px] mb-1.5 flex items-center gap-2 min-w-0">
          <span
            className={`truncate min-w-0 font-semibold text-xs ${speakerColors.name}`}
          >
            {speaker.name}
          </span>
          <span aria-hidden className="text-tg-text-hint shrink-0">·</span>
          <span className="tabular-nums text-tg-text-hint shrink-0">{time}</span>
        </div>

        {replyTo && replyToSpeaker && replyToSpeakerColors && (
          <button
            type="button"
            onClick={() => scrollToMessage(replyTo.id)}
            className={`w-full text-left mb-2 rounded-xl px-2.5 py-1.5 text-xs border-l-[3px] transition-transform active:scale-[0.99] flex items-center gap-1.5 ${replyToSpeakerColors.replyBg} ${replyToSpeakerColors.border}`}
            aria-label="Перейти к исходному сообщению"
          >
            <span
              className={`font-semibold truncate min-w-0 ${replyToSpeakerColors.name}`}
            >
              {replyToSpeaker.name}
            </span>
            <span className="text-tg-text-hint shrink-0" aria-hidden>·</span>
            <span aria-hidden className="shrink-0">{replyTo.kind === "voice" ? "🎙️" : "🟢"}</span>
            <span className="tabular-nums text-tg-text shrink-0">
              {formatDuration(replyTo.duration)}
            </span>
          </button>
        )}

        {msg.kind === "voice" ? (
          <VoicePlayer src={src} totalSeconds={msg.duration} />
        ) : (
          <VideoNote src={src} totalSeconds={msg.duration} />
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
      {!isIn && <div className="shrink-0 mt-1.5">{speakerAvatar}</div>}
    </div>
  );
}

/** TG-style voice player: round play/pause + thin progress bar + duration. */
function VoicePlayer({ src, totalSeconds }: { src: string; totalSeconds: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const { speed, cycle } = usePlaybackSpeed();

  // Mirror the cycle-button choice onto the live element. Browsers honour
  // playbackRate mutation on a playing element, so cycling mid-play takes
  // effect immediately.
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
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
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-1 rounded-full bg-tg-bg/40 overflow-hidden">
          <div
            className="h-full bg-tg-text-accent transition-[width] duration-100 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-tg-text-hint">{elapsedDisplay}</div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          cycle();
        }}
        aria-label={`Скорость воспроизведения: ${formatSpeed(speed)}`}
        title="Скорость"
        className={`shrink-0 inline-flex items-center justify-center min-w-[2.25rem] h-7 px-2 rounded-full text-[11px] font-semibold tabular-nums transition-colors active:scale-95 ${
          speed !== 1
            ? "bg-tg-text-accent/15 text-tg-text-accent"
            : "bg-tg-bg-secondary/60 text-tg-text-hint"
        }`}
      >
        {formatSpeed(speed)}
      </button>
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
 * TG-style video note: a circular video clip with a progress arc that fills
 * around it as playback progresses. Tap-to-toggle, native controls hidden.
 * Duration label sits below the circle (TG-style understated meta).
 */
function VideoNote({ src, totalSeconds }: { src: string; totalSeconds: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const { speed, cycle } = usePlaybackSpeed();

  // Mirror onto the live element. Same `<video>` is used both inline and
  // when lifted to the fullscreen overlay, so the rate persists across modes.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.pause();
    else void v.play();
  }

  const progress = Math.min(1, totalSeconds > 0 ? current / totalSeconds : 0);
  const SIZE = 192;
  const STROKE = 3;
  const RADIUS = SIZE / 2 - STROKE;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashoffset = CIRC * (1 - progress);

  const elapsedDisplay = playing
    ? formatDuration(Math.floor(current))
    : formatDuration(totalSeconds);

  // Idle: snug inline circle so the bubble stays narrow.
  // Playing: lifts to a centered, near-full-viewport square (TG-native).
  const buttonClass = playing
    ? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 block w-[min(85vw,85vh)] h-[min(85vw,85vh)]"
    : "relative block w-28 h-28 sm:w-32 sm:h-32 md:w-36 md:h-36";

  return (
    <>
      {playing && (
        <button
          type="button"
          aria-label="Закрыть"
          onClick={toggle}
          className="fixed inset-0 z-40 bg-black/75 animate-fade-in cursor-default"
        />
      )}
      <div className="inline-flex flex-col items-center max-w-full">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Пауза" : "Воспроизвести"}
          className={buttonClass}
        >
        <div className="absolute inset-0 rounded-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={src}
            preload="metadata"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setCurrent(0);
            }}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {!playing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <PlayIcon size={36} className="text-white drop-shadow" />
            </div>
          )}
        </div>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="white"
            strokeOpacity="0.18"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            className="text-tg-text-accent"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={dashoffset}
            style={{ transition: "stroke-dashoffset 100ms linear" }}
          />
        </svg>
      </button>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums text-tg-text-hint">
          <span>{elapsedDisplay}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycle();
            }}
            aria-label={`Скорость воспроизведения: ${formatSpeed(speed)}`}
            title="Скорость"
            className={`inline-flex items-center justify-center min-w-[2rem] h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums transition-colors active:scale-95 ${
              speed !== 1
                ? "bg-tg-text-accent/15 text-tg-text-accent"
                : "bg-tg-bg-secondary/60 text-tg-text-hint"
            }`}
          >
            {formatSpeed(speed)}
          </button>
        </div>
      </div>
    </>
  );
}

function PlayIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M3 1.5L12 7L3 12.5z" />
    </svg>
  );
}

function PauseIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <rect x="2" y="1" width="3.5" height="12" rx="1" />
      <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
    </svg>
  );
}
