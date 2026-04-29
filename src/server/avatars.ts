import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";

/**
 * Fetches the user's most-recent profile photo from Telegram and caches the
 * file_id (the path is short-lived; we resolve it on demand each time the
 * avatar route is hit).
 *
 * Tolerant — never throws to the caller. /start and auth/session call it
 * opportunistically; they should not fail when TG returns an error or the
 * user has no profile photo.
 */
export async function refreshUserAvatar(userInternalId: number, tgUserId: number): Promise<void> {
  try {
    const photos = await getBot().api.getUserProfilePhotos(tgUserId, { limit: 1 });
    const sb = getServiceRoleClient();

    if (!photos || photos.total_count === 0 || !photos.photos[0]?.length) {
      // No photo or hidden by privacy. Mark fetched so we don't re-query
      // on every auth/session call.
      await sb
        .from("users")
        .update({
          avatar_file_id: null,
          avatar_file_unique_id: null,
          avatar_fetched_at: new Date().toISOString(),
        })
        .eq("id", userInternalId);
      return;
    }

    const sizes = photos.photos[0]; // PhotoSize[]
    // Aim for ~320 wide; fall back to the largest available.
    const target =
      sizes.find((s) => (s.width ?? 0) >= 320) ?? sizes[sizes.length - 1] ?? sizes[0];
    if (!target) return;

    await sb
      .from("users")
      .update({
        avatar_file_id: target.file_id,
        avatar_file_unique_id: target.file_unique_id,
        avatar_fetched_at: new Date().toISOString(),
      })
      .eq("id", userInternalId);
  } catch (e) {
    console.warn("refreshUserAvatar failed", { tgUserId, reason: (e as Error).message });
  }
}
