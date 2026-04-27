"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ClaimButton } from "./ClaimButton";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";

type InboxMessage = {
  id: number;
  student_id: number;
  kind: "voice" | "video_note";
  duration: number;
  status: "pending" | "claimed" | "answered" | "expired" | "orphaned";
  created_at: string;
  users: { name: string | null } | null;
};

export function InboxList({ jwt }: { jwt: string }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  const load = useCallback(async () => {
    const r = await fetch("/api/inbox", { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return;
    const d = (await r.json()) as { messages: InboxMessage[] };
    setMessages(d.messages);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeMessages(jwt, load);

  return (
    <ul className="divide-y">
      {messages.map((m) => {
        const name = m.users?.name ?? "Ученик";
        const min = Math.floor(m.duration / 60);
        const sec = (m.duration % 60).toString().padStart(2, "0");
        return (
          <li key={m.id} className="py-3 flex items-center justify-between gap-4">
            <Link href={`/students/${m.student_id}`} className="flex-1">
              <div className="font-medium">{name}</div>
              <div className="text-sm text-gray-500">
                {m.kind === "voice" ? "🎙️" : "🟢"} {min}:{sec} • {m.status}
              </div>
            </Link>
            {m.status === "pending" && (
              <ClaimButton jwt={jwt} messageId={m.id} onClaimed={load} />
            )}
            {m.status === "claimed" && (
              <span className="text-sm text-amber-600">Жду твой ответ в чате</span>
            )}
            {m.status === "answered" && (
              <span className="text-sm text-green-600">Отвечено</span>
            )}
          </li>
        );
      })}
      {messages.length === 0 && (
        <li className="py-6 text-center text-gray-500">Пока ничего нет.</li>
      )}
    </ul>
  );
}
