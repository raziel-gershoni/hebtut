import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest } from "@/lib/auth-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Accepts a client-side media error report and writes one structured row
 * to audit_events (action: `client.media_error`). Used by the diagnostics
 * helper in `src/lib/diag.ts` to give us visibility into failures on
 * platforms we don't dev against (Android TGMA, TG Desktop, TG Web).
 *
 * Auth: any signed-in user (admin / teacher / student) can report. The
 * actor id on the audit row is the reporter.
 *
 * Anti-abuse: a per-(actor, step) debounce in this process drops repeat
 * reports inside a 10 s window. Pair with the per-tab rate limit in the
 * client helper for two-layer flood protection.
 */

const Body = z.object({
  step: z.string().min(1).max(64),
  err: z
    .object({
      message: z.string().max(2000),
      name: z.string().max(128).optional(),
      stack_top: z.string().max(2000).optional(),
    })
    .strict(),
  ctx: z.record(z.unknown()).optional(),
  env: z.record(z.unknown()).optional(),
});

const recent = new Map<string, number>();
const DEBOUNCE_MS = 10_000;

export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!user) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const { step, err, ctx, env } = parsed.data;

  const key = `${user.id}:${step}`;
  const now = Date.now();
  const prev = recent.get(key) ?? 0;
  if (now - prev < DEBOUNCE_MS) {
    return Response.json(
      { ok: true, debounced: true },
      { headers: noStoreHeaders },
    );
  }
  recent.set(key, now);
  // Periodic cleanup: prune entries older than 60s when the map grows.
  if (recent.size > 100) {
    for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  }

  await recordAudit({
    action: "client.media_error",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: { step, err, ctx: ctx ?? {}, env: env ?? {} },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
