"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

/**
 * Subscribes to INSERT events on `audit_events` so the admin journal page
 * can prepend new rows live without polling. Calls `onInsert` with the
 * newly-inserted row payload.
 */
export function useRealtimeAudit(
  jwt: string,
  onInsert: (row: Record<string, unknown>) => void,
): void {
  useEffect(() => {
    const sb = createBrowserClient(jwt);
    const channel = sb
      .channel("audit-events-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_events" },
        (payload) => onInsert(payload.new as Record<string, unknown>),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [jwt, onInsert]);
}
