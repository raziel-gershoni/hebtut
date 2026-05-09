import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.union([
  z.object({
    start: z.string().regex(/^\d{1,2}:\d{2}$/),
    end: z.string().regex(/^\d{1,2}:\d{2}$/),
  }),
  z.object({ clear: z.literal(true) }),
]);

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: row } = await sb
    .from("subscriptions")
    .select("response_window_start, response_window_end, response_window_tz")
    .eq("user_id", user.id)
    .maybeSingle();
  return Response.json(
    {
      start: row?.response_window_start ?? null,
      end: row?.response_window_end ?? null,
      tz: row?.response_window_tz ?? "Asia/Jerusalem",
    },
    { headers: noStoreHeaders },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  const cleared = "clear" in parsed.data;
  const update: { response_window_start: string | null; response_window_end: string | null } =
    "clear" in parsed.data
      ? { response_window_start: null, response_window_end: null }
      : {
          response_window_start: parsed.data.start,
          response_window_end: parsed.data.end,
        };

  await sb.from("subscriptions").upsert(
    {
      user_id: user.id,
      ...update,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  await recordAudit({
    action: cleared ? "response_window.cleared" : "response_window.set",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: cleared
      ? {}
      : { start: (parsed.data as { start: string }).start, end: (parsed.data as { end: string }).end },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
