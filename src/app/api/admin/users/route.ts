import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";
import type { SubscriptionStatus } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SubscriptionSummary {
  status: SubscriptionStatus;
  trial_ends_at: string;
  current_period_ends_at: string | null;
  frozen_until: string | null;
  transcripts_enabled: boolean;
  translation_enabled: boolean;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select(
      "id, tg_user_id, tg_username, name, preferred_name, display_handle, display_emoji, role, is_admin, status, created_at, role_changed_at, avatar_file_id",
    )
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });
  const userRows = data ?? [];

  // Pull subscriptions in one round-trip so the table can render the per-row
  // status badge without the supabase client's rate limit kicking in. Joining
  // via a separate query (not nested-select) keeps the existing one-table
  // shape for the lazy-backfill block below.
  const ids = userRows.map((u) => u.id);
  const { data: subs } = ids.length
    ? await sb
        .from("subscriptions")
        .select(
          "user_id, status, trial_ends_at, current_period_ends_at, frozen_until, transcripts_enabled, translation_enabled",
        )
        .in("user_id", ids)
    : { data: [] as (SubscriptionSummary & { user_id: number })[] };
  const subByUser = new Map<number, SubscriptionSummary>();
  for (const s of subs ?? []) {
    subByUser.set(s.user_id, {
      status: s.status,
      trial_ends_at: s.trial_ends_at,
      current_period_ends_at: s.current_period_ends_at,
      frozen_until: s.frozen_until,
      transcripts_enabled: s.transcripts_enabled,
      translation_enabled: s.translation_enabled,
    });
  }

  // Lazy backfill: legacy rows have NULL display_handle. Compute, write back
  // (fire-and-forget so the response isn't blocked), and fill the response too.
  const backfills: { id: number; handle: string; emoji: string }[] = [];
  const enriched = userRows.map((u) => {
    let handle = u.display_handle;
    let emoji = u.display_emoji;
    if (!handle || !emoji) {
      const h = userHandle(u.tg_user_id);
      handle = h.handle;
      emoji = h.emoji;
      backfills.push({ id: u.id, handle, emoji });
    }
    const { avatar_file_id, ...rest } = u;
    return {
      ...rest,
      display_handle: handle,
      display_emoji: emoji,
      has_avatar: !!avatar_file_id,
      subscription: subByUser.get(u.id) ?? null,
    };
  });
  if (backfills.length > 0) {
    void Promise.all(
      backfills.map((b) =>
        sb
          .from("users")
          .update({ display_handle: b.handle, display_emoji: b.emoji })
          .eq("id", b.id),
      ),
    ).catch((e) => console.warn("display_handle backfill failed", e));
  }

  return Response.json({ users: enriched }, { headers: noStoreHeaders });
}
