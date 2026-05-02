import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mark every inbound (user-written) feedback message in this user's thread
 * as read. Fire-and-forget from the FeedbackThread mount. Powers the unread
 * badge in the admin chats list.
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
  await sb
    .from("feedback_messages")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("direction", "in")
    .eq("status", "sent");

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
