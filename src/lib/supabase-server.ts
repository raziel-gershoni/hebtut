import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv, publicEnv } from "./env";
import type { Database } from "@/types/database";

let cached: SupabaseClient<Database> | null = null;

export function getServiceRoleClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
