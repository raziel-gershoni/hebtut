import { getServiceRoleClient } from "@/lib/supabase-server";

const TTL_MS = 30_000;

// Single shared Map cache keyed by app_settings.key. 30s TTL so the bot
// doesn't hit Supabase on every inbound media event; the admin PATCH route
// invalidates the whole cache after writing, so a flip takes effect
// immediately within the writing process. Other Node workers see it on
// their next cache miss (≤ 30s lag).
const cache = new Map<string, { value: boolean; at: number }>();

/**
 * Pure decision core for a settings read, extracted for testability.
 *
 * A transient read ERROR must not masquerade as "toggle off": that exact
 * confusion silently disabled auto-transcription in prod (the false got
 * cached for the full TTL, so a single Supabase blip muted a feature for
 * 30s with zero trace). On error we serve the stale cached value when one
 * exists — and never cache, so the next call retries immediately. Only an
 * error with a stone-cold cache fails closed to `false`.
 */
export function resolveSettingRead(
  staleValue: boolean | undefined,
  data: { value: unknown } | null,
  error: { message: string } | null,
): { value: boolean; cacheable: boolean } {
  if (error) return { value: staleValue ?? false, cacheable: false };
  return { value: data?.value === true, cacheable: true };
}

async function getBoolSetting(key: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.warn("[settings] read failed; serving fallback", {
      key,
      err: error.message,
    });
  }
  const result = resolveSettingRead(hit?.value, data, error);
  if (result.cacheable) cache.set(key, { value: result.value, at: now });
  return result.value;
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

/**
 * Auto-transcript of teacher voice / video replies. Default ON via the
 * row inserted in migration 20260524000004 — the helper itself stays
 * absent-equals-false like the others, so a missing row in a freshly
 * provisioned dev env behaves "off" (safer than a hidden feature firing).
 */
export function getTranscriptsEnabled(): Promise<boolean> {
  return getBoolSetting("transcripts_enabled");
}

/**
 * Russian translation alongside the auto-transcript. Default ON via the
 * row inserted in migration 20260527000001. Effective delivery requires
 * both this global toggle AND the per-user `subscriptions.translation_enabled`
 * AND the source language not being Russian.
 */
export function getTranslationEnabled(): Promise<boolean> {
  return getBoolSetting("translation_enabled");
}

export function invalidateSettingsCache(): void {
  // Expire in place rather than clear(): the entries double as the
  // last-known-good fallback for errored reads (see resolveSettingRead).
  // at: 0 forces a fresh DB read on the next access — an admin flip still
  // takes effect immediately — without dropping outage resilience for
  // every other key in this instance.
  for (const [key, entry] of cache) {
    cache.set(key, { ...entry, at: 0 });
  }
}
