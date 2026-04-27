import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";

let bootstrapped = false;

export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapped) return;
  const sb = getServiceRoleClient();
  const ids = serverEnv.BOOTSTRAP_ADMIN_TG_USER_IDS;

  for (const tgId of ids) {
    const { data } = await sb
      .from("users")
      .select("id, role")
      .eq("tg_user_id", tgId)
      .maybeSingle();

    if (!data) {
      await sb.from("users").insert({
        tg_user_id: tgId,
        tg_chat_id: tgId,
        role: "admin",
        name: "bootstrap admin",
        role_changed_at: new Date().toISOString(),
      });
    } else if (data.role !== "admin") {
      await sb
        .from("users")
        .update({ role: "admin", role_changed_at: new Date().toISOString() })
        .eq("id", data.id);
    }
  }
  bootstrapped = true;
}
