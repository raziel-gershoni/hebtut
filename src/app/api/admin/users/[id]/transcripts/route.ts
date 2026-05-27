import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * PATCH /api/admin/users/[id]/transcripts
 *
 * Body: { transcripts_enabled?: boolean; translation_enabled?: boolean }
 *
 * Writes the per-user delivery toggles on `subscriptions`. Effective
 * delivery for the student also requires the matching GLOBAL admin
 * toggles (transcripts_enabled, translation_enabled) and, for
 * translation, the source language not being Russian.
 *
 * Admin-only. Audited as user.transcripts_update with from/to per key.
 */

const Body = z
  .object({
    transcripts_enabled: z.boolean().optional(),
    translation_enabled: z.boolean().optional(),
  })
  .refine(
    (v) => v.transcripts_enabled !== undefined || v.translation_enabled !== undefined,
    { message: "no fields" },
  );

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const { data: prior } = await sb
    .from("subscriptions")
    .select("transcripts_enabled, translation_enabled")
    .eq("user_id", targetId)
    .maybeSingle();
  if (!prior) {
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  }

  const patch: { transcripts_enabled?: boolean; translation_enabled?: boolean; updated_at: string } =
    { updated_at: new Date().toISOString() };
  if (parsed.data.transcripts_enabled !== undefined) {
    patch.transcripts_enabled = parsed.data.transcripts_enabled;
  }
  if (parsed.data.translation_enabled !== undefined) {
    patch.translation_enabled = parsed.data.translation_enabled;
  }

  const { error } = await sb
    .from("subscriptions")
    .update(patch)
    .eq("user_id", targetId);
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  await recordAudit({
    action: "user.transcripts_update",
    actorId: user.id,
    subjectType: "user",
    subjectId: targetId,
    meta: {
      from: {
        transcripts_enabled: prior.transcripts_enabled,
        translation_enabled: prior.translation_enabled,
      },
      to: {
        transcripts_enabled: patch.transcripts_enabled ?? prior.transcripts_enabled,
        translation_enabled: patch.translation_enabled ?? prior.translation_enabled,
      },
      by: "admin",
    },
  });

  return Response.json(
    {
      ok: true,
      transcripts_enabled: patch.transcripts_enabled ?? prior.transcripts_enabled,
      translation_enabled: patch.translation_enabled ?? prior.translation_enabled,
    },
    { headers: noStoreHeaders },
  );
}
