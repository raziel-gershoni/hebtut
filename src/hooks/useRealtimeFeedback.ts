"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

/**
 * Subscribes to INSERT / UPDATE on `feedback_messages` so chat surfaces
 * (user side and admin side) update live without polling. Calls `onChange`
 * with no payload — callers refetch their slice.
 */
export function useRealtimeFeedback(jwt: string, onChange: () => void): void {
  useEffect(() => {
    const sb = createBrowserClient(jwt);
    const channel = sb
      .channel("feedback-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feedback_messages" },
        () => onChange(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "feedback_messages" },
        () => onChange(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feedback_claims" },
        () => onChange(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "feedback_claims" },
        () => onChange(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "feedback_claims" },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [jwt, onChange]);
}
