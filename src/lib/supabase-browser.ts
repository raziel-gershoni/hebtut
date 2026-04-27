"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createBrowserClient(jwt: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase public env missing");
  }
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    realtime: { params: { apikey: anonKey } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
