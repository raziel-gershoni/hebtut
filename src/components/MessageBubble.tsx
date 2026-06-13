"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration, ru } from "@/lib/i18n";
import { reportClientMediaError } from "@/lib/diag";
import { Spinner } from "./Spinner";
import { Avatar } from "./Avatar";
import type { SpeakerColorClasses } from "@/lib/speaker-color";
import { usePlaybackSpeed, formatSpeed } from "@/hooks/usePlaybackSpeed";
import { voiceProxyUrl, voiceStoredUrl } from "@/lib/voice-source";
import { usePlayback } from "./PlaybackProvider";

export type ThreadMsg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note" | "text" | "photo" | "video" | "audio";
  duration: number;
  status?: string;
  reply_to_id?: number | null;
  created_at: string;
  teacher_id?: number | null;
  text_content?: string | null;
  media_library_id?: number | null;
  media_library?: {
    title: string | null;
    description: string | null;
    original_filename: string;
    bytes: number;
    kind: "photo" | "video" | "audio";
    storage_path: string;
    /** Presigned R2 GET URL minted by the thread API — the video/audio bubble
     * plays from this directly. */
    url: string;
  } | null;
  transcript_text?: string | null;
  transcript_tg_message_id?: number | null;
  translation_text?: string | null;
  translation_tg_message_id?: number | null;
  /** Short-lived presigned R2 URLs minted by the thread API (null = not stored
   * yet → fall back to the /api/media proxy). storage_caf_url is the voice-only
   * CAF derivative for pre-18.4 WebKit. */
  storage_url?: string | null;
  storage_caf_url?: string | null;
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
  /**
   * When provided, the bubble renders a ✎ next to the transcript that
   * calls this with the message id. ThreadView gates by viewer-can-edit
   * and only passes the callback for editable rows.
   */
  onEditTranscript?: (messageId: number) => void;
  /** Twin of `onEditTranscript` for the translation block. */
  onEditTranslation?: (messageId: number) => void;
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
  onEditTranscript,
  onEditTranslation,
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
        setFeedback(ru.inbox.message.replyFeedbackOk);
        // Mirror the inbox claim flow — close the Mini App so the prompt
        // landing in the teacher's TG chat is visible.
        window.Telegram?.WebApp?.close?.();
      } else if (r.reason === "taken-by-other") {
        setFeedback(ru.inbox.message.replyFeedbackTakenByOther);
      } else {
        setFeedback(ru.inbox.message.replyFeedbackError(r.reason ?? ru.inbox.message.replyFeedbackUnknownReason));
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
            aria-label={ru.inbox.message.jumpToOriginalAriaLabel}
          >
            <span
              className={`font-semibold truncate min-w-0 ${replyToSpeakerColors.name}`}
            >
              {replyToSpeaker.name}
            </span>
            <span className="text-tg-text-hint shrink-0" aria-hidden>·</span>
            <span aria-hidden className="shrink-0">{replyTo.kind === "voice" ? "🎙️" : "🎥"}</span>
            <span className="tabular-nums text-tg-text shrink-0">
              {formatDuration(replyTo.duration)}
            </span>
          </button>
        )}

        {msg.kind === "voice" ? (
          <VoicePlayer
            totalSeconds={msg.duration}
            messageId={msg.id}
            jwt={jwt}
            storageUrl={msg.storage_url}
            storageCafUrl={msg.storage_caf_url}
          />
        ) : msg.kind === "video_note" ? (
          <VideoNote
            storageUrl={msg.storage_url ?? null}
            totalSeconds={msg.duration}
            messageId={msg.id}
            jwt={jwt}
          />
        ) : msg.kind === "text" ? (
          <TextContent text={msg.text_content ?? ""} />
        ) : msg.media_library_id != null ? (
          <LibraryMediaBlock
            kind={msg.kind}
            jwt={jwt}
            libraryId={msg.media_library_id}
            lib={msg.media_library ?? null}
          />
        ) : (
          // Defensive: a media-kind row with no library link. Shouldn't
          // happen because every send writes media_library_id, but if it
          // does we don't want a black hole — fall through to a stub.
          <p className="text-xs text-tg-text-hint italic">медиа недоступно</p>
        )}

        {msg.direction === "out" &&
          (msg.kind === "voice" || msg.kind === "video_note") &&
          msg.transcript_text && (
            <div className="mt-2 text-[12px] text-tg-text-hint italic leading-snug whitespace-pre-wrap break-words">
              {msg.transcript_text}
              {onEditTranscript && (
                <button
                  type="button"
                  onClick={() => onEditTranscript(msg.id)}
                  aria-label={ru.inbox.message.editTranscriptAria}
                  title={ru.inbox.message.editTranscriptAria}
                  className="ml-1.5 inline-flex items-center text-tg-text-link not-italic align-baseline"
                >
                  ✎
                </button>
              )}
            </div>
          )}

        {msg.direction === "out" &&
          (msg.kind === "voice" || msg.kind === "video_note") &&
          msg.translation_text && (
            <div className="mt-2 text-[12px] text-tg-text-hint italic leading-snug whitespace-pre-wrap break-words">
              {msg.translation_text}
              {onEditTranslation && (
                <button
                  type="button"
                  onClick={() => onEditTranslation(msg.id)}
                  aria-label={ru.inbox.message.editTranslationAria}
                  title={ru.inbox.message.editTranslationAria}
                  className="ml-1.5 inline-flex items-center text-tg-text-link not-italic align-baseline"
                >
                  ✎
                </button>
              )}
            </div>
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

/**
 * Text bubble content: just the text with whitespace + line-breaks preserved.
 * No player, no playback-speed pill, no reply-quote rendering at this level —
 * the wrapping bubble (with speaker name, reply quote, reply button) is
 * unchanged. Read-only by design: the Mini App thread view stays a viewer
 * surface, not a composer (teachers send text via TG swipe-reply).
 */
function TextContent({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-tg-text leading-relaxed">
      {text}
    </p>
  );
}

/** TG-style voice player: round play/pause + thin progress bar + duration. */
function VoicePlayer({
  totalSeconds,
  messageId,
  jwt,
  storageUrl,
  storageCafUrl,
}: {
  totalSeconds: number;
  messageId: number;
  jwt: string;
  storageUrl?: string | null;
  storageCafUrl?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const { speed, cycle } = usePlaybackSpeed();
  const { isMyTurn, startPlay, endPlay, userPaused } = usePlayback(messageId);

  // A presigned R2 URL can expire (6h) or hit a transient error; the null-URL
  // fallback is decided at render time only, so a failed stored load would die
  // silently. On such an error switch this player to the proxy and resume;
  // reset when a fresh presigned URL arrives (thread refetch).
  const [useProxy, setUseProxy] = useState(false);
  useEffect(() => {
    setUseProxy(false);
  }, [storageUrl, storageCafUrl]);
  useEffect(() => {
    if (!useProxy) return;
    const a = audioRef.current;
    if (!a) return;
    a.load();
    void a.play().catch(() => {});
  }, [useProxy]);

  // Mirror the cycle-button choice onto the live element. Browsers honour
  // playbackRate mutation on a playing element, so cycling mid-play takes
  // effect immediately.
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [speed]);

  // Cross-bubble coordination. When the provider says "you're up" — either
  // because this bubble was tapped or because the previous voice in the
  // queue ended — call .play(). When isMyTurn flips back to false (someone
  // else picked up, or user paused), pause if we're still running.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isMyTurn && a.paused) {
      void a.play().catch(() => {
        /* autoplay blocked by browser without a prior user gesture — fine */
      });
    } else if (!isMyTurn && !a.paused) {
      a.pause();
    }
  }, [isMyTurn]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    void a.play().catch((e) => {
      // play() rejections never fire the element's error event — report
      // them so a silent no-op tap is at least visible in the journal.
      void reportClientMediaError(
        "preview-load",
        e instanceof Error ? e : new Error(String(e)),
        { message_id: messageId, surface: "voice-play" },
        jwt,
      );
    });
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
        aria-label={playing ? ru.inbox.message.pauseAriaLabel : ru.inbox.message.playAriaLabel}
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
        aria-label={ru.inbox.message.speedAriaLabel(formatSpeed(speed))}
        title={ru.inbox.message.speedTitle}
        className={`shrink-0 inline-flex items-center justify-center min-w-[2.75rem] h-7 px-2.5 rounded-full text-xs font-semibold tabular-nums tracking-tight transition-all duration-150 active:scale-95 ${
          speed !== 1
            ? "bg-tg-text-accent text-white shadow-sm shadow-tg-text-accent/30 ring-1 ring-tg-text-accent/40"
            : "bg-tg-bg-secondary text-tg-text ring-1 ring-tg-text-hint/30 hover:ring-tg-text-hint/60 hover:bg-tg-bg-section shadow-sm"
        }`}
      >
        {formatSpeed(speed)}
      </button>
      <audio
        ref={audioRef}
        src={
          storageUrl && !useProxy
            ? voiceStoredUrl(storageUrl, storageCafUrl ?? null)
            : voiceProxyUrl(messageId, jwt)
        }
        // none, not metadata: duration renders from msg.duration (DB), and
        // a metadata preload would pull proxied bytes for every bubble on
        // thread mount. play() loads on demand, incl. the auto-advance chain.
        preload="none"
        onPlay={() => {
          setPlaying(true);
          startPlay();
        }}
        onPause={() => {
          setPlaying(false);
          // userPaused is a no-op when this bubble isn't the current id —
          // keeps a forced-pause from a sibling-handoff from clearing the queue.
          userPaused();
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
          endPlay();
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onError={(e) => {
          // Stored (R2 presigned) URL failed/expired — retry once via the proxy.
          if (storageUrl && !useProxy) {
            setUseProxy(true);
            return;
          }
          reportMessageMediaError("voice", e.currentTarget.error, messageId, jwt);
        }}
      />
    </div>
  );
}

// Shared onError reporter for the voice/video-note players — these failed
// silently for months (the WebKit webview can't decode some formats and
// the element just sits dead), which made the voice-playback bug
// undiagnosable from the journal.
function reportMessageMediaError(
  kind: "voice" | "video_note",
  err: MediaError | null,
  messageId: number,
  jwt: string,
): void {
  const codes: Record<number, string> = {
    1: "ABORTED",
    2: "NETWORK",
    3: "DECODE",
    4: "SRC_NOT_SUPPORTED",
  };
  void reportClientMediaError(
    "preview-load",
    new Error(
      `${kind} playback load failed: ${
        err ? `${codes[err.code] ?? "UNKNOWN"} · ${err.message || ""}` : "no error obj"
      }`,
    ),
    { message_id: messageId, surface: `${kind}-bubble` },
    jwt,
  );
}

/**
 * TG-style video note: a circular video clip with a progress arc that fills
 * around it as playback progresses. Tap-to-toggle, native controls hidden.
 * Duration label sits below the circle (TG-style understated meta).
 */
function VideoNote({
  storageUrl,
  totalSeconds,
  messageId,
  jwt,
}: {
  storageUrl: string | null;
  totalSeconds: number;
  messageId: number;
  jwt: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const { speed, cycle } = usePlaybackSpeed();
  const { isMyTurn, startPlay, endPlay, userPaused } = usePlayback(messageId);

  // Prefer the stored (R2 presigned) URL; fall back to the proxy on null OR on
  // a failed/expired stored load (see VoicePlayer for the same pattern).
  const proxySrc = `/api/media/${messageId}?token=${encodeURIComponent(jwt)}`;
  const [useProxy, setUseProxy] = useState(false);
  useEffect(() => {
    setUseProxy(false);
  }, [storageUrl]);
  useEffect(() => {
    if (!useProxy) return;
    const v = videoRef.current;
    if (!v) return;
    v.load();
    void v.play().catch(() => {});
  }, [useProxy]);
  const videoSrc = storageUrl && !useProxy ? storageUrl : proxySrc;

  // Mirror onto the live element. Same `<video>` is used both inline and
  // when lifted to the fullscreen overlay, so the rate persists across modes.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isMyTurn && v.paused) {
      void v.play().catch(() => {});
    } else if (!isMyTurn && !v.paused) {
      v.pause();
    }
  }, [isMyTurn]);

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
          aria-label={ru.inbox.message.closeAriaLabel}
          onClick={toggle}
          className="fixed inset-0 z-40 bg-black/75 animate-fade-in cursor-default"
        />
      )}
      <div className="inline-flex flex-col items-center max-w-full">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? ru.inbox.message.pauseAriaLabel : ru.inbox.message.playAriaLabel}
          className={buttonClass}
        >
        <div className="absolute inset-0 rounded-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={videoSrc}
            preload="metadata"
            playsInline
            onPlay={() => {
              setPlaying(true);
              startPlay();
            }}
            onPause={() => {
              setPlaying(false);
              userPaused();
            }}
            onEnded={() => {
              setPlaying(false);
              setCurrent(0);
              endPlay();
            }}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onError={(e) => {
              if (storageUrl && !useProxy) {
                setUseProxy(true);
                return;
              }
              reportMessageMediaError("video_note", e.currentTarget.error, messageId, jwt);
            }}
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycle();
            }}
            aria-label={ru.inbox.message.speedAriaLabel(formatSpeed(speed))}
            title={ru.inbox.message.speedTitle}
            className={`inline-flex items-center justify-center min-w-[2.5rem] h-6 px-2 rounded-full text-[11px] font-semibold tabular-nums tracking-tight transition-all duration-150 active:scale-95 ${
              speed !== 1
                ? "bg-tg-text-accent text-white shadow-sm shadow-tg-text-accent/30 ring-1 ring-tg-text-accent/40"
                : "bg-tg-bg-secondary text-tg-text ring-1 ring-tg-text-hint/30 hover:ring-tg-text-hint/60 hover:bg-tg-bg-section shadow-sm"
            }`}
          >
            {formatSpeed(speed)}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Read-only render of a library-sent photo / video / audio item. Falls back
 * to `original_filename` when no title is set so the tutor can always
 * recognize what was sent. Click-to-zoom for photos opens a full-bleed
 * overlay; videos use native controls; audio uses native controls (the
 * cross-bubble PlaybackProvider intentionally does NOT consume these —
 * library audio doesn't autoplay-chain).
 */
// Shared onError reporter for library media elements — a silent media
// failure in the webview is undiagnosable otherwise (this exact gap hid
// the library-audio playback bug).
function reportLibraryMediaError(
  kind: "video" | "audio",
  err: MediaError | null,
  libraryId: number,
  lib: ThreadMsg["media_library"],
  jwt: string,
): void {
  const codes: Record<number, string> = {
    1: "ABORTED",
    2: "NETWORK",
    3: "DECODE",
    4: "SRC_NOT_SUPPORTED",
  };
  void reportClientMediaError(
    "preview-load",
    new Error(
      `library ${kind} load failed: ${
        err ? `${codes[err.code] ?? "UNKNOWN"} · ${err.message || ""}` : "no error obj"
      }`,
    ),
    {
      library_id: libraryId,
      storage_path: lib?.storage_path ?? undefined,
      surface: "thread-bubble",
    },
    jwt,
  );
}

function LibraryMediaBlock({
  kind,
  jwt,
  libraryId,
  lib,
}: {
  kind: "photo" | "video" | "audio";
  jwt: string;
  libraryId: number;
  lib: ThreadMsg["media_library"];
}) {
  const previewUrl = `/api/admin/media/${libraryId}/preview?token=${encodeURIComponent(jwt)}`;
  const [lightbox, setLightbox] = useState(false);
  const title = lib?.title?.trim() || lib?.original_filename || ru.inbox.message.fileFallback;
  const description = lib?.description?.trim() ?? null;
  const filename = lib?.original_filename ?? null;
  const sizeLabel = lib ? formatBytesShort(lib.bytes) : null;

  return (
    <div className="space-y-2">
      {kind === "photo" && (
        <>
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="block w-full rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 active:opacity-90 transition-opacity"
            aria-label={ru.inbox.message.openImageAriaLabel}
          >
            <img
              src={previewUrl}
              alt={title}
              className="block w-full max-h-72 object-contain"
              loading="lazy"
            />
          </button>
          {lightbox && (
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center animate-fade-in p-4 cursor-zoom-out"
              aria-label={ru.inbox.message.closeAriaLabel}
            >
              <img
                src={previewUrl}
                alt={title}
                className="max-w-full max-h-full object-contain"
              />
            </button>
          )}
        </>
      )}

      {kind === "video" && (
        <video
          // Presigned R2 URL straight from the thread API — bypasses the
          // 302-redirect /preview route because iOS WebKit (TG Mini App
          // webview) is flaky with `<video>` + 302 + cross-origin range
          // requests. Falls back to /preview only if the embed lacks a url.
          src={lib?.url ?? previewUrl}
          controls
          playsInline
          preload="metadata"
          onError={(e) =>
            reportLibraryMediaError("video", e.currentTarget.error, libraryId, lib, jwt)
          }
          className="block w-full max-h-72 rounded-xl bg-black"
        />
      )}

      {kind === "audio" && (
        <audio
          // Same WebKit workaround as video above: `<audio>` ALSO does
          // cross-origin range requests after the redirect and silently
          // reads zero bytes in the TG webview — library audio wouldn't
          // play at all while videos (already fixed) worked. Presigned R2 URL.
          src={lib?.url ?? previewUrl}
          controls
          preload="metadata"
          onError={(e) =>
            reportLibraryMediaError("audio", e.currentTarget.error, libraryId, lib, jwt)
          }
          className="block w-full"
        />
      )}

      <div className="text-xs leading-snug">
        <div className="font-semibold text-tg-text">{title}</div>
        {description && (
          <div className="text-tg-text-hint mt-0.5 whitespace-pre-wrap break-words">
            {description}
          </div>
        )}
        {filename && sizeLabel && (
          <div className="text-tg-text-hint mt-0.5 truncate" title={filename}>
            {filename} · {sizeLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
