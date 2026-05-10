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

const Body = z.object({
  studentIds: z.array(z.coerce.number().int()).min(1).max(500),
  teacherIds: z.array(z.coerce.number().int()).min(1).max(500),
});

/**
 * POST /api/admin/links/bulk
 *
 * Creates the cross-product of links for { studentIds, teacherIds }. Already-
 * existing pairs are silently skipped (counted as `skipped`). Per-pair
 * inserts so the existing role-validation trigger fires per row and a single
 * misconfigured user (e.g. a `pending` row accidentally selected) doesn't
 * poison the entire batch — that pair counts as `failed`.
 *
 * Returns: `{ created, skipped, failed }`. The UI maps these back to its
 * preview ("Создано N связей") and the existing-links view auto-refreshes.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const { studentIds, teacherIds } = parsed.data;

  const sb = getServiceRoleClient();

  // Pre-fetch existing pairs so we can early-skip without each insert
  // round-trip needing to fail-and-retry. A few hundred rows max — cheap.
  const { data: existing } = await sb
    .from("student_teachers")
    .select("student_id, teacher_id")
    .in("student_id", studentIds)
    .in("teacher_id", teacherIds);
  const existsKey = new Set(
    (existing ?? []).map((r) => `${r.student_id}:${r.teacher_id}`),
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { student_id: number; teacher_id: number; reason: string }[] = [];

  for (const sId of studentIds) {
    for (const tId of teacherIds) {
      if (existsKey.has(`${sId}:${tId}`)) {
        skipped++;
        continue;
      }
      const { error } = await sb
        .from("student_teachers")
        .insert({ student_id: sId, teacher_id: tId });
      if (error) {
        // Most likely cause: the role-check trigger rejected (e.g., student
        // wasn't actually role='student'). Surface a count, not an abort.
        failed++;
        failures.push({
          student_id: sId,
          teacher_id: tId,
          reason: error.message,
        });
      } else {
        created++;
      }
    }
  }

  await recordAudit({
    action: "admin.link_bulk_create",
    actorId: user.id,
    subjectType: "link",
    meta: {
      student_ids: studentIds,
      teacher_ids: teacherIds,
      created,
      skipped,
      failed,
      // Truncate to first 5 failures to keep audit row small.
      failures: failures.slice(0, 5),
    },
  });

  return Response.json(
    { created, skipped, failed },
    { headers: noStoreHeaders },
  );
}
