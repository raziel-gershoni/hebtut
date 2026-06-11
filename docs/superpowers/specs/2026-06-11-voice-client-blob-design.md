# Voice playback: client-side blob loading — design

**Date:** 2026-06-11
**Status:** SUPERSEDED same day — prod evidence (media.fallback_served:
acao=null) proved TG file responses send no CORS header at all, so the
client-side fetch can never read the bytes on any platform. Voice is
served proxy-only (the ?proxy=1 path became the only path); the
zero-traffic follow-up under consideration is store-once-in-Supabase
(decision deferred to w/c 2026-06-15, reminder scheduled).

## Root cause recap (forensically established)

WebKit's native media loader is fragile against Telegram's file CDN
(unsniffed Content-Type, range/buffering specifics). Telegram swapped
that CDN's nginx 1.18.0 → 1.30.1 between 2026-05-13 and 2026-05-28
(Wayback-archived headers), breaking previously-working voice playback.
Our interim fix (76548c9) proxied bytes through Vercel — correct but
violating the PoC's zero-server-traffic design.

## Fix

Take WebKit's network loader out of the conversation: the client
`fetch()`es the bytes itself (immune to Content-Type/range serving
details; TG CORS is `*`, archived stable across the swap) and hands
WebKit a **local blob** with a self-declared type.

- `/api/media/[messageId]` voice branch: default returns the PoC's
  **302** (zero media traffic through Vercel). The full proxy + CAF
  remux path stays behind `?proxy=1` as the automatic fallback.
- New `src/lib/voice-source.ts`: fetch via the 302 (Authorization
  header — browsers strip it on the cross-origin redirect hop, so it
  never reaches TG), then `prepareVoiceBytes`:
  - ogg-capable client → blob `audio/ogg`
  - pre-18.4 WebKit → in-browser CAF remux → blob `audio/x-caf`
  - remux failure (OggCafError) → ogg blob + diag
- `src/server/ogg-to-caf.ts` moves to `src/lib/ogg-to-caf.ts`
  (verified dependency-free; runs in the browser as-is).
- `VoicePlayer`: lazy source — nothing fetched until play intent
  (preserves the preload=none economy); object URL cached per bubble,
  revoked on unmount only (WebKit pulls blob media lazily — early
  revoke kills playback); on fetch/play failure → swap src to the
  `?proxy=1` server fallback once, report via existing diag.
- video_note untouched (302 + `<video src>`, works).

## Traffic / privacy

Per play: one authenticated 302 (~hundreds of bytes) through Vercel —
the PoC footprint. Media bytes flow TG→client directly. Nothing stored.
Bot-token-URL visibility to trusted teachers = unchanged PoC trade-off.

## Resilience

If TG's undocumented CORS ever disappears, the client fetch fails →
automatic per-play fallback to the server proxy + journal diag — players
keep working while we learn TG changed again.

## Risks

- Blob+ogg on physical iOS has no upstream CI coverage (simulator lacks
  the codec) — owner device-test is the verification gate.
- Programmatic play() after an async fetch relies on the TG webview's
  relaxed autoplay policy (already exercised daily by the auto-advance
  chain) — fallback covers a refusal.

## Out of scope

Storing voice artifacts (Supabase/R2) — documented alternative if TG
CORS vanishes permanently. Avatar/video_note token-URL hygiene.
