import type { NextRequest } from "next/server";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mark all admin replies (direction='out') in the caller's feedback thread
 * as read. Fire-and-forget from the FeedbackChat mount.
 */
export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!user) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  if (user.isAdmin)
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  await sb
    .from("feedback_messages")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("direction", "out")
    .eq("status", "sent");

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
