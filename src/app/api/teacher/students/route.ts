import type { NextRequest } from "next/server";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LinkRow {
  student_id: number;
  users:
    | {
        id: number;
        tg_user_id: number;
        display_handle: string | null;
        display_emoji: string | null;
      }
    | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!hasRole(user, ["teacher"])) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const { data: links, error } = await sb
    .from("student_teachers")
    .select(
      "student_id, users!student_teachers_student_id_fkey(id, tg_user_id, display_handle, display_emoji)",
    )
    .eq("teacher_id", user.id);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  const students = ((links ?? []) as unknown as LinkRow[])
    .map((l) => l.users)
    .filter((u): u is NonNullable<LinkRow["users"]> => !!u)
    .map((u) => {
      const h = u.display_handle && u.display_emoji
        ? { handle: u.display_handle, emoji: u.display_emoji }
        : userHandle(u.tg_user_id);
      return { id: u.id, handle: h.handle, emoji: h.emoji };
    })
    .sort((a, b) => a.handle.localeCompare(b.handle, "ru"));

  return Response.json({ students }, { headers: noStoreHeaders });
}
