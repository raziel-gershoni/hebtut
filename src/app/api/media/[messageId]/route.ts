import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { oggOpusToCaf, OggCafError } from "@/lib/ogg-to-caf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The ?proxy=1 fallback downloads + serves voice bytes inside this
// invocation; same ceiling rationale as /api/webhook — default 10s can be
// tight on a slow TG CDN fetch, 60 is the Pro ceiling, no-op on Hobby.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403 });
  }
  const messageId = Number(params.messageId);
  if (!Number.isInteger(messageId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, student_id, kind, file_id")
    .eq("id", messageId)
    .single();
  if (!msg) return new Response("not found", { status: 404 });

  // Text messages have no media to serve.
  if (msg.kind === "text" || !msg.file_id) {
    return new Response("not media", { status: 400 });
  }

  if (!user.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", msg.student_id)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403 });
  }

  const file = await getBot().api.getFile(msg.file_id);
  if (!file.file_path) return new Response("no path", { status: 502 });
  const tgUrl = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

  // VOICE: always proxied. The zero-traffic alternatives are PROVEN dead:
  // - native <audio> on the 302 fails — TG's CDN serves voice as
  //   application/octet-stream and WebKit's AVFoundation won't sniff Ogg
  //   (MP4 video notes survive the same redirect because ftyp IS sniffed);
  // - client-side fetch of the bytes fails — TG file responses carry NO
  //   Access-Control-Allow-Origin at all (journal-verified in prod,
  //   2026-06-11: media.fallback_served meta showed acao=null), so a
  //   browser can never read them cross-origin.
  // So we serve the bytes ourselves: explicit audio/ogg + Range support,
  // plus ?format=caf for pre-18.4 WebKit (lossless Opus→CAF remux —
  // those engines can't decode Ogg in any form). Voice files are tiny
  // (Opus mono ~25-30 kbps), so whole-file buffering is fine. The planned
  // zero-Vercel-traffic follow-up is store-once-in-Supabase (decision
  // pending — see docs/superpowers/specs/2026-06-11-voice-client-blob-design.md).
  const q = new URL(req.url).searchParams;
  if (msg.kind === "voice") {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const upstream = await fetch(tgUrl);
      if (!upstream.ok) return new Response("upstream failed", { status: 502 });
      bytes = new Uint8Array(await upstream.arrayBuffer());
    } catch (e) {
      // Network-level rejection (DNS, reset, mid-body abort) — same 502 as
      // a non-ok response instead of an opaque Next 500.
      console.warn("[media] tg fetch failed", {
        message_id: messageId,
        reason: (e as Error).message,
      });
      return new Response("upstream failed", { status: 502 });
    }
    let contentType = "audio/ogg";

    if (q.get("format") === "caf") {
      try {
        bytes = oggOpusToCaf(bytes);
        contentType = "audio/x-caf";
      } catch (e) {
        // Unexpected stream shape — serve the original Ogg rather than
        // failing the request; the client's onError diag will tell us.
        if (!(e instanceof OggCafError)) throw e;
        console.warn("[media] caf remux failed; serving ogg", {
          message_id: messageId,
          reason: e.message,
        });
      }
    }
    return rangeResponse(req, bytes, contentType);
  }

  // Non-voice kinds (video_note plays fine natively through the redirect —
  // MP4 gets sniffed). The token-in-URL exposure to trusted teachers is the
  // PoC's accepted trade-off. Cacheable for the same window TG guarantees
  // file_path validity (≥1h) so a replay skips the auth+getFile round-trip;
  // Response.redirect() can't carry headers.
  return new Response(null, {
    status: 302,
    headers: { Location: tgUrl, "Cache-Control": "private, max-age=3600" },
  });
}

/**
 * Serve a fully-buffered body honoring single-range requests — WebKit's
 * <audio> requires working Range/206 for seeking and duration display.
 */
function rangeResponse(
  req: NextRequest,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Private: the URL carries a JWT; let the device cache replays briefly.
    "Cache-Control": "private, max-age=3600",
  };
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      // suffix form: last N bytes
      const n = Number(m[2]);
      start = Math.max(0, bytes.length - n);
      end = bytes.length - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? bytes.length - 1 : Math.min(Number(m[2]), bytes.length - 1);
    }
    if (start > end || start >= bytes.length) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${bytes.length}` },
      });
    }
    const slice = bytes.subarray(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": String(slice.length),
      },
    });
  }
  return new Response(bytes, {
    status: 200,
    headers: { ...headers, "Content-Length": String(bytes.length) },
  });
}
