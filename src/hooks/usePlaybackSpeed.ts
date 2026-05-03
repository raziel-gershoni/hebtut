"use client";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hebtut.playback-speed";
const SPEEDS = [1, 1.25, 1.5, 2] as const;
const DEFAULT_SPEED = 1;

export type PlaybackSpeed = (typeof SPEEDS)[number];

function clampToKnown(value: unknown): PlaybackSpeed {
  if (typeof value === "number" && (SPEEDS as readonly number[]).includes(value)) {
    return value as PlaybackSpeed;
  }
  return DEFAULT_SPEED;
}

/**
 * Device-local sticky playback speed for voice + video-note players.
 * Cycles through 1× → 1.25× → 1.5× → 2× → 1×; the chosen speed is
 * persisted in localStorage so the next message picked up uses the same
 * rate. No backend.
 */
export function usePlaybackSpeed(): {
  speed: PlaybackSpeed;
  cycle: () => void;
} {
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_SPEED);

  // Hydrate from localStorage on mount. SSR-safe: window guard.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw != null) setSpeed(clampToKnown(Number(raw)));
    } catch {
      // localStorage may be blocked (private mode, embedded WebView). Ignore.
    }
  }, []);

  // Cross-component sync: any component using this hook reflects updates
  // from sibling players within the same tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setSpeed(clampToKnown(Number(e.newValue ?? DEFAULT_SPEED)));
    }
    function onCustom(e: Event) {
      const next = (e as CustomEvent<number>).detail;
      setSpeed(clampToKnown(next));
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("hebtut:playback-speed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("hebtut:playback-speed", onCustom);
    };
  }, []);

  const cycle = useCallback(() => {
    setSpeed((curr) => {
      const idx = SPEEDS.indexOf(curr);
      const next = SPEEDS[(idx + 1) % SPEEDS.length]!;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignored
      }
      // Notify siblings in the same tab — `storage` event only fires across tabs.
      window.dispatchEvent(
        new CustomEvent<number>("hebtut:playback-speed", { detail: next }),
      );
      return next;
    });
  }, []);

  return { speed, cycle };
}

export function formatSpeed(speed: PlaybackSpeed): string {
  return `${speed}×`;
}
