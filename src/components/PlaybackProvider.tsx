"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Cross-bubble playback coordination for the teacher's thread view.
 *
 * - Tap a voice → that one plays.
 * - When it ends, the NEXT playable message (chronological) auto-starts.
 * - Pausing or letting it stop "naturally without an end" (handed off to
 *   another bubble) breaks the chain — only natural `onEnded` advances.
 * - Fresh-arrival autoplay: if a new playable message appears in `messages`
 *   while we're idle AND the last play ended within `FRESH_ARRIVAL_WINDOW_MS`,
 *   the fresh one auto-plays. Outside that window, the new bubble appears
 *   silently and the teacher taps to start.
 *
 * Out-of-provider callers (e.g., a player rendered standalone in a test) get
 * no-op stubs from `usePlayback` so they keep working without coordination.
 */

const FRESH_ARRIVAL_WINDOW_MS = 30_000;

interface PlayableMessage {
  id: number;
  kind: "voice" | "video_note" | string;
  created_at: string;
}

interface PlaybackContextValue {
  currentMessageId: number | null;
  startPlay: (id: number) => void;
  endPlay: (id: number) => void;
  userPaused: (id: number) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({
  messages,
  children,
}: {
  messages: PlayableMessage[];
  children: ReactNode;
}) {
  const [currentMessageId, setCurrentMessageId] = useState<number | null>(null);
  const [lastEndedAt, setLastEndedAt] = useState<number | null>(null);
  const previousMaxIdRef = useRef<number>(0);

  // Filtered + sorted playable list. Used to pick "next after current" on
  // natural end, and to detect newly-arrived messages for fresh-arrival
  // autoplay.
  const playable = useMemo<PlayableMessage[]>(
    () =>
      messages
        .filter((m) => m.kind === "voice" || m.kind === "video_note")
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages],
  );

  // Fresh-arrival autoplay watchdog. Compares the newest playable id against
  // the watermark we saw last; if it's strictly greater AND we're idle AND
  // recently engaged, kick off the fresh one.
  useEffect(() => {
    if (playable.length === 0) return;
    const newestId = playable[playable.length - 1]!.id;
    const prevMax = previousMaxIdRef.current;
    previousMaxIdRef.current = newestId;
    // Skip initial mount: if prevMax was 0, this is just us seeing the
    // initial list, nothing "arrived" yet.
    if (prevMax === 0 || newestId <= prevMax) return;
    if (currentMessageId !== null) return; // busy — let the queue catch up
    if (lastEndedAt == null) return; // never played
    if (Date.now() - lastEndedAt > FRESH_ARRIVAL_WINDOW_MS) return;
    setCurrentMessageId(newestId);
  }, [playable, currentMessageId, lastEndedAt]);

  const startPlay = useCallback((id: number) => {
    setCurrentMessageId(id);
  }, []);

  const userPaused = useCallback((id: number) => {
    // Only clear if the paused bubble was the active one — handoff cases
    // (a different bubble started, this one was forced to pause) shouldn't
    // wipe the new active id.
    setCurrentMessageId((cur) => (cur === id ? null : cur));
  }, []);

  const endPlay = useCallback(
    (id: number) => {
      setLastEndedAt(Date.now());
      const idx = playable.findIndex((p) => p.id === id);
      const next =
        idx >= 0 && idx < playable.length - 1 ? playable[idx + 1]! : null;
      setCurrentMessageId(next ? next.id : null);
    },
    [playable],
  );

  const value = useMemo<PlaybackContextValue>(
    () => ({ currentMessageId, startPlay, endPlay, userPaused }),
    [currentMessageId, startPlay, endPlay, userPaused],
  );

  return (
    <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
  );
}

export function usePlayback(messageId: number): {
  isMyTurn: boolean;
  startPlay: () => void;
  endPlay: () => void;
  userPaused: () => void;
} {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    return {
      isMyTurn: false,
      startPlay: () => {},
      endPlay: () => {},
      userPaused: () => {},
    };
  }
  return {
    isMyTurn: ctx.currentMessageId === messageId,
    startPlay: () => ctx.startPlay(messageId),
    endPlay: () => ctx.endPlay(messageId),
    userPaused: () => ctx.userPaused(messageId),
  };
}
