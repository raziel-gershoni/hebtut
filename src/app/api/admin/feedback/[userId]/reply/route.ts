import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { serverEnv } from "@/lib/env";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  text: z.string().min(1).max(4000),
});

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

  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return new Response("bad body", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { data: target } = await sb
    .from("users")
    .select("id, tg_chat_id, is_admin")
    .eq("id", userId)
    .single();
  if (!target)
    return new Response("not found", { status: 404, headers: noStoreHeaders });
  if (target.is_admin)
    return new Response("admins don't receive feedback DMs", {
      status: 400,
      headers: noStoreHeaders,
    });

  // Claim guard: only the holder can reply. Refresh the TTL on success so
  // the active admin's session sticks while they're engaged.
  const { data: existingClaim } = await sb
    .from("feedback_claims")
    .select("admin_id, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  const claimActive =
    !!existingClaim && new Date(existingClaim.expires_at).getTime() > Date.now();
  if (claimActive && existingClaim.admin_id !== me.id) {
    const { data: holder } = await sb
      .from("users")
      .select("name, display_handle, tg_user_id")
      .eq("id", existingClaim.admin_id)
      .single();
    return Response.json(
      {
        ok: false,
        reason: "taken-by-other",
        holder: {
          id: existingClaim.admin_id,
          name: holder?.name ?? null,
          handle:
            holder?.display_handle ??
            userHandle(holder?.tg_user_id ?? 0).handle,
        },
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const { data: row, error } = await sb
    .from("feedback_messages")
    .insert({
      user_id: userId,
      direction: "out",
      author_id: me.id,
      text_content: parsed.data.text,
    })
    .select("id")
    .single();
  if (error || !row)
    return new Response(error?.message ?? "insert failed", {
      status: 500,
      headers: noStoreHeaders,
    });

  // Refresh / acquire the claim — keeps the session sticky and silently
  // takes ownership if it had expired between mount and send.
  const ttlMs = serverEnv.CLAIM_TTL_MINUTES * 60_000;
  const claimExpiresAt = new Date(Date.now() + ttlMs).toISOString();
  await sb.from("feedback_claims").upsert(
    {
      user_id: userId,
      admin_id: me.id,
      claimed_at: new Date().toISOString(),
      expires_at: claimExpiresAt,
    },
    { onConflict: "user_id" },
  );
  await recordAudit({
    action: "feedback.claim_refresh",
    actorId: me.id,
    subjectType: "user",
    subjectId: userId,
    meta: { kind: "reply-tail", expires_at: claimExpiresAt },
  });

  // Wake-up DM with a web_app button straight to /feedback.
  const url = `${serverEnv.APP_BASE_URL.replace(/\/$/, "")}/feedback`;
  try {
    await getBot().api.sendMessage(target.tg_chat_id, ru.bot.notifications.userFeedbackReplyPing, {
      reply_markup: {
        inline_keyboard: [[{ text: ru.bot.labels.openInline, web_app: { url } }]],
      },
    });
  } catch (e) {
    console.warn("user feedback DM failed", {
      chat_id: target.tg_chat_id,
      reason: (e as Error).message,
    });
  }

  await recordAudit({
    action: "feedback.out",
    actorId: me.id,
    subjectType: "user",
    subjectId: userId,
    meta: {
      message_id: row.id,
      snippet: parsed.data.text.slice(0, 80),
    },
  });

  return Response.json({ ok: true, id: row.id }, { headers: noStoreHeaders });
}
