"use client";
import { useEffect, useState } from "react";
import { MessageBubble } from "./MessageBubble";

type ThreadMsg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  status: string;
  created_at: string;
};

export function ThreadView({ jwt, studentId }: { jwt: string; studentId: number }) {
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch(`/api/threads/${studentId}`, { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json() as Promise<{ messages: ThreadMsg[] }>)
      .then((d) => {
        setMessages(d.messages);
        setLoaded(true);
      });
  }, [jwt, studentId]);

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
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} jwt={jwt} />
      ))}
    </div>
  );
}
