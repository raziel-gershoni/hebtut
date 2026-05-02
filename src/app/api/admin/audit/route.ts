import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RawEvent {
  id: number;
  created_at: string;
  actor_id: number | null;
  action: string;
  subject_type: string | null;
  subject_id: number | null;
  meta: Record<string, unknown>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }

  const url = new URL(req.url);
  const actionsRaw = url.searchParams.get("action") ?? "";
  const actions = actionsRaw
    ? actionsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const actor = url.searchParams.get("actor");
  const subjectType = url.searchParams.get("subject_type");
  const subjectId = url.searchParams.get("subject_id");
  const since =
    url.searchParams.get("since") ??
    new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const until = url.searchParams.get("until");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );
  const before = url.searchParams.get("before");

  const sb = getServiceRoleClient();
  let q = sb
    .from("audit_events")
    .select("id, created_at, actor_id, action, subject_type, subject_id, meta")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (until) q = q.lte("created_at", until);
  if (actions.length > 0) q = q.in("action", actions);
  if (actor) q = q.eq("actor_id", Number(actor));
  if (subjectType) q = q.eq("subject_type", subjectType);
  if (subjectId) q = q.eq("subject_id", Number(subjectId));
  if (before) q = q.lt("id", Number(before));

  const { data: rows, error } = await q;
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  const trimmed = (rows ?? []) as RawEvent[];
  const hasMore = trimmed.length > limit;
  const events = hasMore ? trimmed.slice(0, limit) : trimmed;
  const nextCursor = hasMore ? events[events.length - 1]!.id : null;

  // Resolve actor_id → real name + handle for display.
  const actorIds = Array.from(
    new Set(
      events
        .map((e) => e.actor_id)
        .filter((id): id is number => id != null),
    ),
  );
  const actorsById = new Map<
    number,
    { id: number; name: string | null; display_handle: string | null }
  >();
  if (actorIds.length > 0) {
    const { data: actorRows } = await sb
      .from("users")
      .select("id, name, display_handle")
      .in("id", actorIds);
    for (const a of actorRows ?? []) actorsById.set(a.id, a);
  }

  return Response.json(
    {
      events: events.map((e) => ({
        id: e.id,
        created_at: e.created_at,
        actor: e.actor_id != null ? actorsById.get(e.actor_id) ?? null : null,
        action: e.action,
        subject_type: e.subject_type,
        subject_id: e.subject_id,
        meta: e.meta,
      })),
      has_more: hasMore,
      next_cursor: nextCursor,
    },
    { headers: noStoreHeaders },
  );
}
