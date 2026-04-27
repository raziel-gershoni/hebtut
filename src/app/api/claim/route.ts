import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { claimMessage } from "@/server/claim";
import { readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ messageId: z.coerce.number().int() });

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) {
    return new Response("forbidden", { status: 403 });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });

  const result = await claimMessage(parsed.data.messageId, user.id);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 409 });
  return Response.json({ ok: true });
}
