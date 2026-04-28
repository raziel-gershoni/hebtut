import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";

let bootstrapped = false;

/**
 * Asserts that every TG id in BOOTSTRAP_ADMIN_TG_USER_IDS has `is_admin=true`
 * in the users table. Memoized per process; runs again on each cold start.
 *
 * Critically: this NEVER touches `role`. A bootstrap admin is free to also
 * pick a working role (teacher / student / pending) via the admin panel —
 * cold starts won't undo it.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapped) return;
  const sb = getServiceRoleClient();
  const ids = serverEnv.BOOTSTRAP_ADMIN_TG_USER_IDS;

  for (const tgId of ids) {
    const { data } = await sb
      .from("users")
      .select("id, is_admin")
      .eq("tg_user_id", tgId)
      .maybeSingle();

    if (!data) {
      // First sight of a bootstrap admin: insert with role=pending so they
      // can pick their own working role from the admin panel afterwards.
      // Real TG name lands via /api/auth/session on first Mini App load.
      await sb.from("users").insert({
        tg_user_id: tgId,
        tg_chat_id: tgId,
        role: "pending",
        is_admin: true,
        name: null,
      });
    } else if (!data.is_admin) {
      await sb.from("users").update({ is_admin: true }).eq("id", data.id);
    }
  }
  bootstrapped = true;
}
