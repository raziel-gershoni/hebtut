"use client";
import { useEffect, useRef } from "react";

const CADENCE_MS = 30_000;
const IDLE_MS = 2 * 60 * 1000;

/**
 * Heartbeat hook for tutor work-time tracking. Mounts in InboxList and
 * ThreadView. Posts to /api/tutor-work/heartbeat every 30s while:
 *   - hook is enabled (caller decides — typically role === "teacher")
 *   - TG WebApp.isActive is true (Mini App focused among open ones)
 *   - document.visibilityState is "visible"
 *   - user is not idle (input within last 2 min)
 *
 * Flushes a final heartbeat on TG `deactivated` and on `beforeunload` via
 * navigator.sendBeacon. Skips fire on mount until a tick passes so duplicate
 * mounts (StrictMode) don't double-credit.
 */
export function useWorkHeartbeat(enabled: boolean, jwt: string): void {
  const lastInputRef = useRef<number>(Date.now());
  const tgActiveRef = useRef<boolean>(true);

  // Track user input to derive idle state
  useEffect(() => {
    if (!enabled) return;
    const onInput = () => {
      lastInputRef.current = Date.now();
    };
    const events = ["scroll", "click", "keydown", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, onInput, { passive: true }),
    );
    return () =>
      events.forEach((e) => window.removeEventListener(e, onInput));
  }, [enabled]);

  // Track TG active state. Defaults to true if TG SDK unavailable (dev mode).
  useEffect(() => {
    if (!enabled) return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tgActiveRef.current = tg.isActive ?? true;
    const onActivated = () => {
      tgActiveRef.current = true;
    };
    const onDeactivated = () => {
      tgActiveRef.current = false;
      // Best-effort flush on deactivate
      try {
        navigator.sendBeacon(
          "/api/tutor-work/heartbeat",
          new Blob(
            [JSON.stringify({})],
            { type: "application/json" },
          ),
        );
      } catch {
        // sendBeacon may be unavailable; ignore
      }
    };
    tg.onEvent?.("activated", onActivated);
    tg.onEvent?.("deactivated", onDeactivated);
    return () => {
      tg.offEvent?.("activated", onActivated);
      tg.offEvent?.("deactivated", onDeactivated);
    };
  }, [enabled]);

  // Heartbeat tick
  useEffect(() => {
    if (!enabled) return;
    const send = async () => {
      try {
        await fetch("/api/tutor-work/heartbeat", {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
        });
      } catch {
        // Network errors are fine — next tick will retry
      }
    };
    const tick = () => {
      const idle = Date.now() - lastInputRef.current > IDLE_MS;
      const visible = document.visibilityState === "visible";
      if (!idle && tgActiveRef.current && visible) {
        void send();
      }
    };
    const id = window.setInterval(tick, CADENCE_MS);
    return () => window.clearInterval(id);
  }, [enabled, jwt]);

  // Best-effort flush on unload
  useEffect(() => {
    if (!enabled) return;
    const onUnload = () => {
      try {
        navigator.sendBeacon(
          "/api/tutor-work/heartbeat",
          new Blob([JSON.stringify({})], { type: "application/json" }),
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [enabled]);
}
