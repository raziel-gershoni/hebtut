import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { getTranscriptsEnabled, getTranslationEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Student-self GET + PATCH of their own transcript/translation toggles
 * on `subscriptions`. Effective delivery still requires the matching
 * global admin toggles to be on (and, for translation, the source
 * language not being Russian).
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

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["student"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const [{ data: row }, globalTranscripts, globalTranslation] = await Promise.all([
    sb
      .from("subscriptions")
      .select("transcripts_enabled, translation_enabled")
      .eq("user_id", user.id)
      .maybeSingle(),
    getTranscriptsEnabled(),
    getTranslationEnabled(),
  ]);
  return Response.json(
    {
      transcripts_enabled: row?.transcripts_enabled ?? true,
      translation_enabled: row?.translation_enabled ?? true,
      // Global toggles surfaced so the student page can grey out the per-user
      // checkbox + show a "off globally" notice when the admin disabled the
      // feature centrally. Effective delivery is global AND per-user.
      global_transcripts_enabled: globalTranscripts,
      global_translation_enabled: globalTranslation,
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
  const { data: prior } = await sb
    .from("subscriptions")
    .select("transcripts_enabled, translation_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  const patch: {
    user_id: number;
    transcripts_enabled?: boolean;
    translation_enabled?: boolean;
    updated_at: string;
  } = { user_id: user.id, updated_at: new Date().toISOString() };
  if (parsed.data.transcripts_enabled !== undefined) {
    patch.transcripts_enabled = parsed.data.transcripts_enabled;
  }
  if (parsed.data.translation_enabled !== undefined) {
    patch.translation_enabled = parsed.data.translation_enabled;
  }

  await sb.from("subscriptions").upsert(patch, { onConflict: "user_id" });

  await recordAudit({
    action: "user.transcripts_update",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: {
      from: {
        transcripts_enabled: prior?.transcripts_enabled ?? true,
        translation_enabled: prior?.translation_enabled ?? true,
      },
      to: {
        transcripts_enabled:
          patch.transcripts_enabled ?? prior?.transcripts_enabled ?? true,
        translation_enabled:
          patch.translation_enabled ?? prior?.translation_enabled ?? true,
      },
      by: "self",
    },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
