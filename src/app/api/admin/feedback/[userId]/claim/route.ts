import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Claim a feedback chat for the calling admin. PK on user_id ensures only
 * one admin holds a given chat at a time. If another admin holds an active
 * claim, returns 409 with their handle so the UI can show "Берёт X" without
 * a second round-trip.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me))
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  const userId = Number(params.userId);
  if (!Number.isInteger(userId))
    return new Response("bad id", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();

  // Read existing claim. If active and held by another admin → 409.
  const { data: existing } = await sb
    .from("feedback_claims")
    .select("admin_id, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  const claimActive =
    !!existing && new Date(existing.expires_at).getTime() > Date.now();
  if (claimActive && existing.admin_id !== me.id) {
    const { data: holder } = await sb
      .from("users")
      .select("name, display_handle, tg_user_id")
      .eq("id", existing.admin_id)
      .single();
    const holderHandle =
      holder?.display_handle ?? userHandle(holder?.tg_user_id ?? 0).handle;
    return Response.json(
      {
        ok: false,
        reason: "taken-by-other",
        holder: {
          id: existing.admin_id,
          name: holder?.name ?? null,
          handle: holderHandle,
        },
        expires_at: existing.expires_at,
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const { error } = await sb.from("feedback_claims").upsert(
    {
      user_id: userId,
      admin_id: me.id,
      claimed_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "user_id" },
  );
  if (error)
    return new Response(error.message, { status: 500, headers: noStoreHeaders });

  await recordAudit({
    action: "feedback.claim_refresh",
    actorId: me.id,
    subjectType: "user",
    subjectId: userId,
    meta: {
      kind: claimActive && existing.admin_id === me.id ? "session-refresh" : "claim",
      expires_at: expiresAt,
    },
  });

  return Response.json(
    { ok: true, expires_at: expiresAt },
    { headers: noStoreHeaders },
  );
}
