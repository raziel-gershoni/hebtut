import { isOggOpusSupported } from "@/lib/audio-support";

/**
 * Voice messages are served by our own proxy (/api/media/[messageId]) —
 * the only delivery that works in the TG webview. The zero-traffic
 * alternatives were eliminated by evidence:
 *  - <audio> on a 302 to TG's CDN: AVFoundation rejects voice's
 *    application/octet-stream (no Ogg sniffing; this is what broke after
 *    TG's mid-May 2026 nginx swap);
 *  - client fetch of the bytes: TG file responses send NO
 *    Access-Control-Allow-Origin (journal-proven 2026-06-11), so a
 *    browser can never read them cross-origin.
 * The planned zero-Vercel-traffic follow-up is store-once-in-Supabase
 * (decision pending; see docs/superpowers/specs/2026-06-11-voice-client-blob-design.md).
 *
 * Pre-18.4-WebKit engines can't decode Ogg in any container, so they ask
 * the proxy for the lossless CAF remux (?format=caf).
 */
export function voiceProxyUrl(messageId: number, jwt: string): string {
  const caf = isOggOpusSupported() ? "" : "&format=caf";
  return `/api/media/${messageId}?token=${encodeURIComponent(jwt)}${caf}`;
}
