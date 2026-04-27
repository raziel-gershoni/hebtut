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

  useEffect(() => {
    void fetch(`/api/threads/${studentId}`, { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json() as Promise<{ messages: ThreadMsg[] }>)
      .then((d) => setMessages(d.messages));
  }, [jwt, studentId]);

  return (
    <div className="flex flex-col">
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} jwt={jwt} />
      ))}
      {messages.length === 0 && (
        <p className="text-center text-gray-500 py-6">Сообщений ещё нет.</p>
      )}
    </div>
  );
}
