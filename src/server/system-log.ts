import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Json } from "@/types/database";

export type SystemLogLevel = "info" | "warn" | "error";

/**
 * Persist a structured log row readable from the admin panel — a stand-in for
 * Vercel logs on the free tier. Fail-soft: a logging failure must never break
 * the caller, so it falls back to console.
 */
export async function logSystem(
  level: SystemLogLevel,
  source: string,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const { error } = await sb
      .from("system_logs")
      .insert({ level, source, message, meta: meta as Json });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[system-log] persist failed", {
      source,
      message,
      reason: (e as Error).message,
    });
  }
}

/** Delete rows older than `days` (called by the store-media cron). Fail-soft. */
export async function pruneSystemLogs(days: number): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    await sb.from("system_logs").delete().lt("created_at", cutoff);
  } catch (e) {
    console.warn("[system-log] prune failed", { reason: (e as Error).message });
  }
}
