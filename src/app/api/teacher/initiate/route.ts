import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { startInitiation } from "@/server/claim";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({ studentId: z.coerce.number().int().positive() });

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["teacher"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }

  const result = await startInitiation(user.id, parsed.data.studentId);
  if (result.ok) {
    return Response.json({ ok: true, kind: result.kind }, { headers: noStoreHeaders });
  }
  const status =
    result.reason === "taken-by-other"
      ? 409
      : result.reason === "not-allowed"
        ? 403
        : result.reason === "not-found"
          ? 404
          : result.reason === "fatal"
            ? 500
            : 400;
  return Response.json({ error: result.reason }, { status, headers: noStoreHeaders });
}
