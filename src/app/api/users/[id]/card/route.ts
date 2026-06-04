import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { resolveOrigin } from "@/server/origin";
import type { SubscriptionStatus } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TagDictEntry {
  id: number;
  name: string;
  slug: string;
}

/**
 * Bundles everything the StudentCardDialog needs into one fetch:
 * - subscription status (raw enum + relevant dates for the badge)
 * - acquisition origin (direct / referral / source)
 * - tag dictionary (admin-managed) + the IDs assigned to this student
 *
 * Auth: admin OR teacher linked to this student.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const studentId = Number(params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return new Response("bad id", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  if (!user.isAdmin) {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) {
      return new Response("forbidden", { status: 403, headers: noStoreHeaders });
    }
  }

  const [subRes, dictRes, assignedRes, origin] = await Promise.all([
    sb
      .from("subscriptions")
      .select("status, trial_ends_at, current_period_ends_at, frozen_until")
      .eq("user_id", studentId)
      .maybeSingle(),
    sb.from("media_tags").select("id, name, slug").order("name", { ascending: true }),
    sb.from("user_tag_links").select("tag_id").eq("user_id", studentId),
    resolveOrigin(studentId),
  ]);

  const sub = subRes.data;
  const status = sub
    ? {
        kind: sub.status as SubscriptionStatus,
        trial_ends_at: sub.trial_ends_at,
        current_period_ends_at: sub.current_period_ends_at,
        frozen_until: sub.frozen_until,
      }
    : null;

  const dictionary = (dictRes.data ?? []) as TagDictEntry[];
  const assigned = ((assignedRes.data ?? []) as { tag_id: number }[]).map((r) => r.tag_id);

  return Response.json(
    {
      status,
      origin,
      tags: { dictionary, assigned },
    },
    { headers: noStoreHeaders },
  );
}
