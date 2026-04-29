"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { MessageBubble, type ThreadMsg } from "./MessageBubble";
import { Avatar } from "./Avatar";

interface ClaimInfo {
  teacher_id: number;
  teacher_name: string;
  expires_at: string;
}

interface StudentMeta {
  id: number;
  name: string | null;
  has_avatar: boolean;
}

export function ThreadView({
  jwt,
  studentId,
  myUserId,
  myName,
}: {
  jwt: string;
  studentId: number;
  myUserId: number;
  myName: string | null;
}) {
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [student, setStudent] = useState<StudentMeta | null>(null);
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
    const d = (await r.json()) as {
      messages: ThreadMsg[];
      claim?: ClaimInfo | null;
      student?: StudentMeta | null;
    };
    setMessages(d.messages);
    setClaim(d.claim ?? null);
    setStudent(d.student ?? null);
    setLoaded(true);
  }, [jwt, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark this chat as read on mount — fire-and-forget.
  useEffect(() => {
    void fetch("/api/inbox/seen", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
  }, [jwt, studentId]);

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

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const replyDisabledReason =
    claim && claim.teacher_id !== myUserId ? `Берёт ${claim.teacher_name}` : null;

  const onReply = useCallback(
    async (messageId: number): Promise<{ ok: boolean; reason?: string }> => {
      const r = await fetch("/api/replies/start", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        kind?: string;
        error?: string;
      };
      if (r.ok && d.ok) {
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

  const studentDisplay = student?.name ?? "Ученик";
  const myDisplay = myName ?? "Ты";
  const studentAvatarUrl =
    student?.has_avatar
      ? `/api/avatar/${student.id}?token=${encodeURIComponent(jwt)}`
      : undefined;

  return (
    <div className="flex flex-col gap-1">
      <header className="flex items-center gap-3 mb-3 pb-3 border-b border-tg-text-hint/15">
        <Avatar size={48} name={studentDisplay} imageUrl={studentAvatarUrl} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-semibold tracking-tight truncate">{studentDisplay}</div>
          <div className="text-xs text-tg-text-hint">ученик</div>
        </div>
      </header>
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
          replyTo={m.reply_to_id != null ? byId.get(m.reply_to_id) ?? null : null}
          studentName={studentDisplay}
          myName={myDisplay}
          onReply={onReply}
          replyDisabledReason={replyDisabledReason}
        />
      ))}
    </div>
  );
}
