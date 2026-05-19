import { getServiceRoleClient } from "@/lib/supabase-server";

const TTL_MS = 30_000;

// Single shared Map cache keyed by app_settings.key. 30s TTL so the bot
// doesn't hit Supabase on every inbound media event; the admin PATCH route
// invalidates the whole cache after writing, so a flip takes effect
// immediately within the writing process. Other Node workers see it on
// their next cache miss (≤ 30s lag).
const cache = new Map<string, { value: boolean; at: number }>();

async function getBoolSetting(key: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = data?.value === true;
  cache.set(key, { value, at: now });
  return value;
}

/**
 * "Send quota-related chat replies" toggle (over-quota rejection,
 * post-send remainder confirmation, /start greeting). Default false.
 */
export function getQuotaChatNotificationsEnabled(): Promise<boolean> {
  return getBoolSetting("quota_chat_notifications_enabled");
}

/**
 * "Telegram Stars billing surfaces visible to users" toggle. Default false.
 * When false: PayCTA flips to "Связаться с админом", cron renewal DMs link
 * to /feedback (no invoice generated), `/api/billing/invoice` returns 503,
 * the access-gate locked-template inline button label + URL adapt.
 *
 * The Stars adapter, webhook handlers (pre_checkout_query +
 * successful_payment), and applySuccessfulPayment all stay live so any
 * in-flight payment is still honored.
 */
export function getBillingStarsEnabled(): Promise<boolean> {
  return getBoolSetting("billing_stars_enabled");
}

/**
 * "Show anonymous adjective+animal handles instead of first names" toggle.
 * Default false → peer-facing surfaces show students' real names (collected
 * during onboarding's awaiting_name step) and their TG avatars when
 * available.
 *
 * When ON: legacy behaviour — display_handle (e.g. "Гордый Орёл") + emoji
 * on a colored circle. Used as an opt-in fallback for cohorts that prefer
 * anonymity; affects every peer-facing surface globally.
 */
export function getDisplayAnonymousHandlesEnabled(): Promise<boolean> {
  return getBoolSetting("display_anonymous_handles_enabled");
}

/**
 * "Teachers can upload to the shared media library" toggle. Default false →
 * only admins can upload. When ON, teachers can also upload. Send / edit /
 * delete of existing items are unaffected.
 */
export function getMediaUploadsTeachersEnabled(): Promise<boolean> {
  return getBoolSetting("media_uploads_teachers_enabled");
}

export function invalidateSettingsCache(): void {
  cache.clear();
}
