"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

export function useRealtimeMessages(jwt: string, onChange: () => void): void {
  useEffect(() => {
    const sb = createBrowserClient(jwt);
    const channel = sb
      .channel("messages-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => onChange(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [jwt, onChange]);
}
