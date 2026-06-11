import { oggOpusToCaf, OggCafError } from "@/lib/ogg-to-caf";
import { isOggOpusSupported } from "@/lib/audio-support";

/**
 * Client-side voice source loading. Root-cause workaround for WebKit ×
 * Telegram-CDN incompatibility: instead of pointing <audio src> at a
 * network URL (whose Content-Type / range behavior we don't control —
 * TG's CDN serves octet-stream and broke WebKit playback after its
 * mid-May 2026 nginx swap), the client downloads the bytes itself via
 * fetch (immune to those serving details; TG sends CORS `*`) and hands
 * WebKit a LOCAL blob with a self-declared type:
 *  - Ogg-capable engines (Chromium, WebKit ≥ iOS 18.4 / macOS 15.4):
 *    blob typed audio/ogg.
 *  - Older WebKit (no Ogg decoder at all): the dependency-free Opus→CAF
 *    remuxer runs right here in the browser — blob typed audio/x-caf
 *    (WebKit plays Opus-in-CAF since iOS 11). The explicit type is
 *    mandatory: WebKit's MIME sniffer has no CAF magic.
 * Bytes flow TG→client directly; the server only issues the 302.
 */

/** Pure core — decide the playable bytes + blob type for this client. */
export function prepareVoiceBytes(
  bytes: Uint8Array<ArrayBuffer>,
  oggSupported: boolean,
): { bytes: Uint8Array<ArrayBuffer>; type: "audio/ogg" | "audio/x-caf" } {
  if (oggSupported) return { bytes, type: "audio/ogg" };
  try {
    return { bytes: oggOpusToCaf(bytes), type: "audio/x-caf" };
  } catch (e) {
    // Unexpected stream shape: fall back to the raw ogg — it won't play on
    // pre-18.4 WebKit, but the element's onError diag will tell us exactly
    // that instead of us masking it.
    if (e instanceof OggCafError) return { bytes, type: "audio/ogg" };
    throw e;
  }
}

/**
 * Fetch the voice bytes through /api/media's 302 (auth via header — the
 * browser strips Authorization on the cross-origin redirect hop, so the
 * JWT never reaches TG) and return an object URL for the <audio> element.
 *
 * Caller owns the URL lifecycle: revoke on unmount, NOT on 'ended' —
 * WebKit pulls blob media lazily via range requests, and an early revoke
 * kills playback silently.
 */
export async function loadVoiceObjectUrl(messageId: number, jwt: string): Promise<string> {
  // Hard timeout: a stalled TG CDN connection would otherwise never settle
  // this promise — leaving the play button disabled forever and the proxy
  // fallback unreachable. On engines without AbortSignal.timeout (pre-16
  // WebKit) we go unguarded; a failure there still lands on the fallback.
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(15_000)
      : undefined;
  const r = await fetch(`/api/media/${messageId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal,
  });
  if (!r.ok) throw new Error(`voice fetch failed: ${r.status}`);
  const raw = new Uint8Array(await r.arrayBuffer());
  const prepared = prepareVoiceBytes(raw, isOggOpusSupported());
  return URL.createObjectURL(new Blob([prepared.bytes], { type: prepared.type }));
}

/** The server-proxy fallback URL — today's shipped behavior, used when the
 * direct fetch fails (e.g. TG drops CORS) or blob playback errors. */
export function voiceProxyUrl(messageId: number, jwt: string): string {
  const caf = isOggOpusSupported() ? "" : "&format=caf";
  return `/api/media/${messageId}?token=${encodeURIComponent(jwt)}&proxy=1${caf}`;
}
