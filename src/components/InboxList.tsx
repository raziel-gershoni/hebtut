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
  status: "pending" | "answered" | "expired" | "orphaned";
  created_at: string;
  users: { name: string | null } | null;
};

type ActiveClaim = {
  student_id: number;
  teacher_id: number;
  teacher_name: string;
  expires_at: string;
};

export function InboxList({ jwt, myUserId }: { jwt: string; myUserId: number }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [claimsByStudent, setClaimsByStudent] = useState<Map<number, ActiveClaim>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/inbox", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setLoaded(true);
      return;
    }
    const d = (await r.json()) as { messages: InboxMessage[]; claims: ActiveClaim[] };
    setMessages(d.messages);
    setClaimsByStudent(new Map((d.claims ?? []).map((c) => [c.student_id, c])));
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeMessages(jwt, load);

  if (!loaded) {
    return (
      <ul className="space-y-3 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="h-20 rounded-2xl bg-tg-bg-secondary" />
        ))}
      </ul>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
        Пока ничего нет. Сюда придут голосовые от твоих учеников.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {messages.map((m) => (
        <InboxRow
          key={m.id}
          jwt={jwt}
          m={m}
          claim={claimsByStudent.get(m.student_id) ?? null}
          myUserId={myUserId}
          onClaimed={load}
        />
      ))}
    </ul>
  );
}

function InboxRow({
  jwt,
  m,
  claim,
  myUserId,
  onClaimed,
}: {
  jwt: string;
  m: InboxMessage;
  claim: ActiveClaim | null;
  myUserId: number;
  onClaimed: () => void;
}) {
  const name = m.users?.name ?? "Ученик";
  const min = Math.floor(m.duration / 60);
  const sec = (m.duration % 60).toString().padStart(2, "0");
  const kindLabel = m.kind === "voice" ? "🎙️ голосовое" : "🟢 видео";

  const heldByMe = claim?.teacher_id === myUserId;
  const heldByOther = claim && claim.teacher_id !== myUserId;

  return (
    <li className="rounded-2xl bg-tg-bg-section p-4 transition-transform active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <Link href={`/students/${m.student_id}`} className="flex-1 min-w-0 outline-none">
          <div className="flex items-center gap-2">
            <StatusDot status={m.status} heldByMe={heldByMe} heldByOther={!!heldByOther} />
            <span className="font-medium tracking-tight truncate">{name}</span>
          </div>
          <div className="mt-1 text-sm text-tg-text-hint">
            {kindLabel} · {min}:{sec}
          </div>
        </Link>
        <div className="shrink-0">
          {m.status === "pending" && !heldByOther && (
            <ClaimButton jwt={jwt} messageId={m.id} onClaimed={onClaimed} />
          )}
          {m.status === "pending" && heldByOther && (
            <span className="inline-flex items-center h-9 px-3 rounded-full text-xs font-medium bg-tg-bg-secondary text-tg-text-hint">
              {claim!.teacher_name}
            </span>
          )}
          {m.status === "pending" && heldByMe && (
            <span className="inline-flex items-center h-9 px-3 rounded-full text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
              Жду в чате
            </span>
          )}
          {m.status === "answered" && (
            <span className="inline-flex items-center h-9 px-3 rounded-full text-xs font-medium bg-tg-bg-secondary text-tg-text-hint">
              ✓ Отвечено
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusDot({
  status,
  heldByMe,
  heldByOther,
}: {
  status: InboxMessage["status"];
  heldByMe: boolean;
  heldByOther: boolean;
}) {
  if (status === "pending" && heldByMe)
    return <span className="block w-2 h-2 rounded-full bg-amber-500" aria-hidden />;
  if (status === "pending" && heldByOther)
    return <span className="block w-2 h-2 rounded-full bg-tg-text-hint/40" aria-hidden />;
  if (status === "pending")
    return <span className="block w-2 h-2 rounded-full bg-tg-button" aria-hidden />;
  return <span className="block w-2 h-2 rounded-full bg-tg-text-hint/40" aria-hidden />;
}
