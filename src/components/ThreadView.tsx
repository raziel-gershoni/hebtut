"use client";
import { useEffect, useState, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";

type ThreadMsg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  status: string;
  created_at: string;
};

interface ClaimInfo {
  teacher_id: number;
  teacher_name: string;
  expires_at: string;
}

export function ThreadView({
  jwt,
  studentId,
  myUserId,
}: {
  jwt: string;
  studentId: number;
  myUserId: number;
}) {
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/threads/${studentId}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setLoaded(true);
      return;
    }
    const d = (await r.json()) as { messages: ThreadMsg[]; claim?: ClaimInfo | null };
    setMessages(d.messages);
    setClaim(d.claim ?? null);
    setLoaded(true);
  }, [jwt, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [load]);

  const replyDisabledReason =
    claim && claim.teacher_id !== myUserId
      ? `Берёт ${claim.teacher_name}`
      : null;

  const onReply = useCallback(
    async (messageId: number): Promise<{ ok: boolean; reason?: string }> => {
      const r = await fetch("/api/replies/start", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: true; kind?: string; error?: string };
      if (r.ok && d.ok) {
        // Re-fetch so we pick up the new claim state.
        void load();
        return { ok: true };
      }
      return { ok: false, reason: d.error ?? `http-${r.status}` };
    },
    [jwt, load],
  );

  if (!loaded) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-16 w-3/4 rounded-2xl bg-tg-bg-secondary" />
        <div className="h-16 w-3/4 ml-auto rounded-2xl bg-tg-bg-secondary" />
        <div className="h-16 w-2/3 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
        Сообщений ещё нет.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {claim && claim.teacher_id === myUserId && (
        <div className="text-xs text-tg-text-hint mb-2">
          Активная сессия с этим учеником — отвечай в чате.
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          msg={m}
          jwt={jwt}
          onReply={onReply}
          replyDisabledReason={replyDisabledReason}
        />
      ))}
    </div>
  );
}
