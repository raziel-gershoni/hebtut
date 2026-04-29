"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { MessageBubble, type ThreadMsg, type Speaker } from "./MessageBubble";
import { Avatar } from "./Avatar";
import { speakerColor, type SpeakerColorClasses } from "@/lib/speaker-color";

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

interface TeacherMeta {
  id: number;
  name: string | null;
  has_avatar: boolean;
}

interface ApiMessage extends ThreadMsg {
  teacher_id: number | null;
  teacher: TeacherMeta | null;
}

export function ThreadView({
  jwt,
  studentId,
  myUserId,
  myHasAvatar,
}: {
  jwt: string;
  studentId: number;
  myUserId: number;
  myHasAvatar: boolean;
}) {
  const [messages, setMessages] = useState<ApiMessage[]>([]);
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
      messages: ApiMessage[];
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

  const studentDisplay = student?.name ?? "Ученик";
  const studentAvatarUrl = useMemo(
    () =>
      student?.has_avatar
        ? `/api/avatar/${student.id}?token=${encodeURIComponent(jwt)}`
        : undefined,
    [student, jwt],
  );

  // For each message, resolve who's speaking. Inbound = the student. Outbound
  // = the teacher who sent it (real name) — but if it's the *current viewer*'s
  // own message, label it "Ты" while still showing their avatar.
  function speakerFor(msg: ApiMessage): Speaker {
    if (msg.direction === "in") {
      return { name: studentDisplay, avatarUrl: studentAvatarUrl };
    }
    if (msg.teacher_id === myUserId) {
      // Always "Ты" for the current viewer's own messages, regardless of
      // whether their TG name is known — matches TG's "You" convention.
      return {
        name: "Ты",
        avatarUrl: myHasAvatar
          ? `/api/avatar/${myUserId}?token=${encodeURIComponent(jwt)}`
          : undefined,
      };
    }
    const t = msg.teacher;
    return {
      name: t?.name ?? "Преподаватель",
      avatarUrl: t?.has_avatar
        ? `/api/avatar/${t.id}?token=${encodeURIComponent(jwt)}`
        : undefined,
    };
  }

  // Stable per-user color so each speaker has a recognizable signature on
  // bubble border + name + reply-quote bar. Self always gets the TG-button
  // hue so own messages stay theme-coherent.
  function colorFor(msg: ApiMessage): SpeakerColorClasses {
    if (msg.direction === "in") {
      return speakerColor(student?.id ?? msg.teacher_id ?? 0, false);
    }
    if (msg.teacher_id === myUserId) return speakerColor(myUserId, true);
    return speakerColor(msg.teacher_id ?? 0, false);
  }

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
      {messages.map((m) => {
        const replyToMsg = m.reply_to_id != null ? byId.get(m.reply_to_id) ?? null : null;
        return (
          <MessageBubble
            key={m.id}
            msg={m}
            jwt={jwt}
            speaker={speakerFor(m)}
            speakerColors={colorFor(m)}
            replyTo={replyToMsg}
            replyToSpeaker={replyToMsg ? speakerFor(replyToMsg) : null}
            replyToSpeakerColors={replyToMsg ? colorFor(replyToMsg) : null}
            onReply={onReply}
            replyDisabledReason={replyDisabledReason}
          />
        );
      })}
    </div>
  );
}
