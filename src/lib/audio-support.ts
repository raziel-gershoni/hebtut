/**
 * Capability detection for Telegram voice playback (Ogg/Opus in <audio>).
 *
 * WebKit only decodes Ogg/Opus natively from iOS 18.4 / macOS Sequoia 15.4
 * (the gate is the OS, not the Safari/TG version); older WebKit plays Opus
 * only inside a CAF container. Telegram's own web clients gate the same way
 * (IS_OPUS_SUPPORTED via canPlayType) — capability detection, not UA
 * sniffing, so iOS 18.4+/Android/desktop Chromium all take the native path
 * automatically.
 *
 * Memoized; SSR-safe (no Audio constructor on the server → false, which is
 * harmless because the value is only consumed in client components).
 */
let cached: boolean | null = null;

export function isOggOpusSupported(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined" || typeof Audio === "undefined") return false;
  try {
    cached = !!new Audio().canPlayType("audio/ogg; codecs=opus").replace(/no/, "");
  } catch {
    cached = false;
  }
  return cached;
}
