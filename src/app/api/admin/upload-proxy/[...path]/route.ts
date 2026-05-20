// TUS (resumable upload) proxy. Forwards every TUS-protocol request from
// the browser to Supabase's `/storage/v1/upload/resumable` endpoint with
// the service-role key swapped in for the Authorization header. Reasons:
//
// 1. Supabase officially recommends TUS for files >6 MB. The single-PUT
//    signed-upload-URL pattern we used before is fragile on cellular
//    iOS WebKit — fetch can resolve "ok" without actually transmitting
//    bytes, leaving ghost storage.objects rows. TUS chunks the upload
//    and explicitly confirms each chunk's offset, so there's no
//    false-success failure mode.
// 2. We can't put a Supabase auth token on the client (service role =
//    full DB access; a real Supabase user JWT would require setting up
//    Supabase Auth which we don't use). Proxying through us lets the
//    client present our existing JWT, we validate admin, then we add
//    the service-role auth Supabase needs.
// 3. Chunk size on the client is 4 MB — well under Vercel's 4.5 MB
//    function body limit. Each chunk is a separate PATCH request, so
//    we never exceed the platform limit regardless of total file size.

import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { publicEnv, serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildTargetUrl(pathSegments: string[]): string {
  const base = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  if (pathSegments.length <= 1) return base; // ["resumable"]
  return `${base}/${pathSegments.slice(1).join("/")}`;
}

function rewriteLocation(supabaseLocation: string): string {
  // Supabase responds with Location pointing back at its own URL. The
  // TUS client uses this URL for subsequent PATCH/HEAD/DELETE — so we
  // rewrite to point back at the proxy.
  const m = supabaseLocation.match(/\/storage\/v1\/upload\/resumable(.*)$/);
  if (!m) return supabaseLocation;
  return `/api/admin/upload-proxy/resumable${m[1]}`;
}

async function forward(
  req: NextRequest,
  params: { path: string[] },
  method: string,
): Promise<Response> {
  const me = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(me)) {
    return new Response("forbidden", { status: 403 });
  }

  const targetUrl = buildTargetUrl(params.path);

  // Forward TUS-spec headers; deliberately drop ours (esp. Authorization,
  // which is OUR JWT — Supabase doesn't know about it). Add Supabase
  // service-role auth.
  const fwdHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    const kl = k.toLowerCase();
    if (
      kl.startsWith("tus-") ||
      kl.startsWith("upload-") ||
      kl === "content-type" ||
      kl === "content-length"
    ) {
      fwdHeaders.set(k, v);
    }
  }
  fwdHeaders.set("Authorization", `Bearer ${serverEnv.SUPABASE_SERVICE_ROLE_KEY}`);
  fwdHeaders.set("apikey", serverEnv.SUPABASE_SERVICE_ROLE_KEY);

  // Buffer the body for POST/PATCH (chunks ≤4 MB — well under Vercel's
  // function memory). GET/HEAD/DELETE have no body.
  let body: ArrayBuffer | null = null;
  if (method === "POST" || method === "PATCH") {
    body = await req.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, {
    method,
    headers: fwdHeaders,
    body,
  });

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (k.toLowerCase() === "location") {
      respHeaders.set(k, rewriteLocation(v));
    } else if (
      k.toLowerCase() === "content-length" ||
      k.toLowerCase() === "transfer-encoding" ||
      k.toLowerCase() === "content-encoding"
    ) {
      // Skip — Next.js sets these itself
    } else {
      respHeaders.set(k, v);
    }
  }
  // HEAD responses must have no body; otherwise stream through.
  const responseBody = method === "HEAD" ? null : await upstream.arrayBuffer();
  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

const makeHandler =
  (method: string) =>
  (req: NextRequest, ctx: { params: { path: string[] } }) =>
    forward(req, ctx.params, method);

export const POST = makeHandler("POST");
export const HEAD = makeHandler("HEAD");
export const PATCH = makeHandler("PATCH");
export const DELETE = makeHandler("DELETE");
export const OPTIONS = makeHandler("OPTIONS");
