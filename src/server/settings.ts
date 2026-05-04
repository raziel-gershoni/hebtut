import { getServiceRoleClient } from "@/lib/supabase-server";

const KEY = "quota_chat_notifications_enabled";
const TTL_MS = 30_000;

let cache: { value: boolean; at: number } | null = null;

/**
 * Reads the global "send quota-related chat replies" toggle. Cached in
 * process for 30s so the bot doesn't hit Supabase on every inbound media
 * event. The admin PATCH route invalidates this cache after writing, so
 * a flip takes effect immediately within the writing process. Other Node
 * workers see it on their next cache miss (≤ 30s lag).
 */
export async function getQuotaChatNotificationsEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const value = data?.value === true;
  cache = { value, at: now };
  return value;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
