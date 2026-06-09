import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { localDateInTz } from "@/lib/time";
import {
  applyDailyCap,
  computeWorkBuckets,
  type WorkBuckets,
} from "@/server/tutor-work";
import { addDays, format, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAILY_CAP_SEC = 16 * 3600;

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tutorId: z.coerce.number().int().optional(),
});

interface DayBucket extends WorkBuckets {
  date: string;
}

interface TutorRollup {
  tutor_id: number;
  tutor_name: string;
  tutor_has_avatar: boolean;
  days: DayBucket[];
  totals: WorkBuckets;
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    tutorId: url.searchParams.get("tutorId") ?? undefined,
  });
  if (!parsed.success) {
    return new Response("bad query", { status: 400, headers: noStoreHeaders });
  }

  const tz = user.tz ?? "UTC";
  const fromDayStart = fromZonedTime(`${parsed.data.from}T00:00:00`, tz);
  const toDayEnd = fromZonedTime(
    `${format(addDays(parseISO(parsed.data.to), 1), "yyyy-MM-dd")}T00:00:00`,
    tz,
  );

  const sb = getServiceRoleClient();

  let query = sb
    .from("tutor_work_events")
    .select("tutor_id, kind, started_at, ended_at")
    .gte("started_at", fromDayStart.toISOString())
    .lt("started_at", toDayEnd.toISOString());
  if (parsed.data.tutorId != null) {
    query = query.eq("tutor_id", parsed.data.tutorId);
  }
  const { data: rows, error } = await query;
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  type WorkRow = {
    tutor_id: number;
    kind: "active" | "playback" | "recording";
    started_at: Date;
    ended_at: Date;
  };

  const byTutorDay = new Map<string, WorkRow[]>();
  for (const r of rows ?? []) {
    const started = new Date(r.started_at);
    const day = localDateInTz(started, tz);
    const key = `${r.tutor_id}:${day}`;
    const bucket = byTutorDay.get(key) ?? [];
    bucket.push({
      tutor_id: r.tutor_id,
      kind: r.kind as "active" | "playback" | "recording",
      started_at: started,
      ended_at: new Date(r.ended_at),
    });
    byTutorDay.set(key, bucket);
  }

  const days: string[] = [];
  {
    let cursor = parseISO(parsed.data.from);
    const last = parseISO(parsed.data.to);
    while (cursor <= last) {
      days.push(format(cursor, "yyyy-MM-dd"));
      cursor = addDays(cursor, 1);
    }
  }

  let tutorIds: number[];
  if (parsed.data.tutorId != null) {
    tutorIds = [parsed.data.tutorId];
  } else {
    tutorIds = Array.from(new Set((rows ?? []).map((r) => r.tutor_id)));
  }

  const { data: tutorRows } = await sb
    .from("users")
    .select("id, name, preferred_name, avatar_file_id")
    .in("id", tutorIds);
  const tutorMeta = new Map(
    (tutorRows ?? []).map((u) => [
      u.id,
      {
        tutor_name: u.preferred_name ?? u.name ?? `ID ${u.id}`,
        tutor_has_avatar: !!u.avatar_file_id,
      },
    ]),
  );

  const tutors: TutorRollup[] = tutorIds.map((tutor_id) => {
    const meta = tutorMeta.get(tutor_id) ?? {
      tutor_name: `ID ${tutor_id}`,
      tutor_has_avatar: false,
    };
    const dayBuckets: DayBucket[] = days.map((date) => {
      const events = byTutorDay.get(`${tutor_id}:${date}`) ?? [];
      const raw = computeWorkBuckets(events);
      const capped = applyDailyCap(raw, DAILY_CAP_SEC);
      return { date, ...capped };
    });
    const totals: WorkBuckets = dayBuckets.reduce(
      (acc, d) => ({
        recording_s: acc.recording_s + d.recording_s,
        playback_s: acc.playback_s + d.playback_s,
        active_s: acc.active_s + d.active_s,
        total_s: acc.total_s + d.total_s,
      }),
      { recording_s: 0, playback_s: 0, active_s: 0, total_s: 0 },
    );
    return { tutor_id, ...meta, days: dayBuckets, totals };
  });

  tutors.sort((a, b) => b.totals.total_s - a.totals.total_s);

  return Response.json(
    {
      range: { from: parsed.data.from, to: parsed.data.to, days: days.length },
      tutors,
    },
    { headers: noStoreHeaders },
  );
}
