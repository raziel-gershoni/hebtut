import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";

/**
 * Where did this student come from? Read off subscriptions:
 * - acquisition_source_id set → advertiser campaign (wins over referral)
 * - referred_by_user_id set → per-user share link
 * - neither → direct registration
 *
 * The "source wins over referral" precedence matches start.ts:
 * src_<slug> attribution overwrites ref_<token> when both somehow
 * arrive (campaign over share link).
 */
export type Origin =
  | { kind: "direct" }
  | { kind: "referral"; referrer: { handle: string } }
  | { kind: "source"; source: { label: string; slug: string } };

export async function resolveOrigin(studentId: number): Promise<Origin> {
  const sb = getServiceRoleClient();
  const { data: sub } = await sb
    .from("subscriptions")
    .select("acquisition_source_id, referred_by_user_id")
    .eq("user_id", studentId)
    .maybeSingle();
  if (!sub) return { kind: "direct" };

  if (sub.acquisition_source_id != null) {
    const { data: source } = await sb
      .from("acquisition_sources")
      .select("slug, label")
      .eq("id", sub.acquisition_source_id)
      .maybeSingle();
    if (source) return { kind: "source", source };
  }

  if (sub.referred_by_user_id != null) {
    const { data: referrer } = await sb
      .from("users")
      .select(
        "tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id",
      )
      .eq("id", sub.referred_by_user_id)
      .maybeSingle();
    if (referrer) {
      const anonMode = await getDisplayAnonymousHandlesEnabled();
      const handle = resolveDisplay(
        {
          tg_user_id: referrer.tg_user_id,
          name: referrer.name,
          preferred_name: referrer.preferred_name,
          display_handle: referrer.display_handle,
          display_emoji: referrer.display_emoji,
          avatar_file_id: referrer.avatar_file_id,
        },
        anonMode,
      ).handle;
      return { kind: "referral", referrer: { handle } };
    }
  }

  return { kind: "direct" };
}
