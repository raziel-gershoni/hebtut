import type { NextRequest } from "next/server";
import { authFromRequest, hasRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LinkRow {
  student_id: number;
  users:
    | {
        id: number;
        tg_user_id: number;
        name: string | null;
        display_handle: string | null;
        display_emoji: string | null;
        avatar_file_id: string | null;
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
      "student_id, users!student_teachers_student_id_fkey(id, tg_user_id, name, display_handle, display_emoji, avatar_file_id)",
    )
    .eq("teacher_id", user.id);
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  const anonMode = await getDisplayAnonymousHandlesEnabled();

  const students = ((links ?? []) as unknown as LinkRow[])
    .map((l) => l.users)
    .filter((u): u is NonNullable<LinkRow["users"]> => !!u)
    .map((u) => {
      const d = resolveDisplay(u, anonMode);
      return { id: u.id, handle: d.handle, emoji: d.emoji, has_avatar: d.has_avatar };
    })
    .sort((a, b) => a.handle.localeCompare(b.handle, "ru"));

  return Response.json({ students }, { headers: noStoreHeaders });
}
