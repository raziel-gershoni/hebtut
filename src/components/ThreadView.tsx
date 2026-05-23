"use client";
import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { differenceInCalendarDays } from "date-fns";
import { MessageBubble, type ThreadMsg, type Speaker } from "./MessageBubble";
import { Avatar } from "./Avatar";
import { DateSeparator } from "./DateSeparator";
import { PlaybackProvider } from "./PlaybackProvider";
import { MediaPicker } from "./MediaPicker";
import { speakerColor, type SpeakerColorClasses } from "@/lib/speaker-color";
import { bgFromHandle } from "@/lib/handle";

interface ClaimInfo {
  teacher_id: number;
  teacher_handle: string;
  teacher_emoji: string;
  expires_at: string;
}

interface StudentMeta {
  id: number;
  handle: string;
  // Names mode → emoji is null and `has_avatar` indicates whether to fetch
  // `/api/avatar/<id>`. Anon mode → emoji is set, has_avatar=false.
  emoji: string | null;
  has_avatar: boolean;
}

interface TeacherMeta {
  id: number;
  handle: string;
  emoji: string | null;
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
  role,
}: {
  jwt: string;
  studentId: number;
  myUserId: number;
  myHasAvatar: boolean;
  role: string;
}) {
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [student, setStudent] = useState<StudentMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [initiateBusy, setInitiateBusy] = useState(false);
  const [initiateError, setInitiateError] = useState<string | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const initialScrollDoneRef = useRef(false);

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

  // Open at the latest message — Telegram convention. Only the FIRST render
  // with messages auto-scrolls; subsequent realtime updates don't yank the
  // viewport if the teacher has scrolled up to read history.
  useEffect(() => {
    if (loaded && messages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      // Defer one frame so message bubbles have rendered and contributed
      // their height to document.body.
      const t = window.setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [loaded, messages.length]);

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
    claim && claim.teacher_id !== myUserId ? `Берёт ${claim.teacher_handle}` : null;

  const canInitiate = role === "teacher" && !replyDisabledReason;

  async function startInitiate() {
    setInitiateBusy(true);
    setInitiateError(null);
    try {
      const r = await fetch("/api/teacher/initiate", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: true; error?: string };
      if (r.ok && d.ok) {
        window.Telegram?.WebApp?.close?.();
        return;
      }
      setInitiateError(
        d.error === "taken-by-other"
          ? "Другой тренер сейчас работает с этим учеником"
          : d.error === "not-allowed"
            ? "Связь с этим учеником утрачена"
            : "Не удалось — попробуй ещё раз",
      );
    } finally {
      setInitiateBusy(false);
    }
  }

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

  const studentDisplay = student?.handle ?? "Ученик";
  // In names mode the server returns emoji=null and has_avatar tells us
  // whether to fetch the real TG photo. In anon mode emoji is set and we
  // render an emoji-on-color circle.
  const studentEmoji = student?.emoji ?? undefined;
  const studentBg = student?.emoji ? bgFromHandle(student.handle) : undefined;
  const studentAvatarUrl =
    student && student.emoji == null && student.has_avatar
      ? `/api/avatar/${student.id}?token=${encodeURIComponent(jwt)}`
      : undefined;

  // For each message, resolve who's speaking. Inbound = the student
  // (handle/name + avatar). Outbound = either the current viewer (label "Ты"
  // — matches TG's "You" convention) or another teacher (handle/name +
  // avatar). The Avatar component prefers imageUrl over emoji over initials.
  function speakerFor(msg: ApiMessage): Speaker {
    if (msg.direction === "in") {
      return {
        name: studentDisplay,
        avatarUrl: studentAvatarUrl,
        emoji: studentEmoji,
        bgClass: studentBg,
      };
    }
    if (msg.teacher_id === myUserId) {
      return {
        name: "Ты",
        avatarUrl: myHasAvatar
          ? `/api/avatar/${myUserId}?token=${encodeURIComponent(jwt)}`
          : undefined,
      };
    }
    const t = msg.teacher;
    const teacherAvatarUrl =
      t && t.emoji == null && t.has_avatar
        ? `/api/avatar/${t.id}?token=${encodeURIComponent(jwt)}`
        : undefined;
    return {
      name: t?.handle ?? "Тренер",
      avatarUrl: teacherAvatarUrl,
      emoji: t?.emoji ?? undefined,
      bgClass: t && t.emoji ? bgFromHandle(t.handle) : undefined,
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

  return (
    <PlaybackProvider messages={messages}>
    <div className="flex flex-col gap-1">
      <header className="flex items-center gap-3 mb-3 pb-3 border-b border-tg-text-hint/15">
        <Avatar size={48} name={studentDisplay} imageUrl={studentAvatarUrl} emoji={studentEmoji} bgClass={studentBg} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-semibold tracking-tight truncate">{studentDisplay}</div>
          <div className="text-xs text-tg-text-hint">ученик</div>
        </div>
        {canInitiate && (
          <button
            type="button"
            disabled={initiateBusy}
            onClick={() => setMediaPickerOpen(true)}
            aria-label="Прикрепить медиа из библиотеки"
            title="Медиа-библиотека"
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-tg-bg-secondary text-tg-text transition-transform active:scale-95 disabled:opacity-50"
          >
            <PaperclipIcon />
          </button>
        )}
        {canInitiate && (
          <button
            type="button"
            disabled={initiateBusy}
            onClick={() => void startInitiate()}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-tg-button text-tg-button-text text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50"
          >
            + Написать
          </button>
        )}
      </header>
      {claim && claim.teacher_id === myUserId && (
        <div className="text-xs text-tg-text-hint mb-2">
          Активная сессия с этим учеником — отвечай в чате.
        </div>
      )}
      {initiateError && (
        <div className="text-xs text-tg-text-destructive mb-2">{initiateError}</div>
      )}
      {messages.length === 0 ? (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          Сообщений ещё нет.
        </div>
      ) : (
        messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const showSep =
            !prev ||
            differenceInCalendarDays(new Date(m.created_at), new Date(prev.created_at)) !== 0;
          const replyToMsg = m.reply_to_id != null ? byId.get(m.reply_to_id) ?? null : null;
          return (
            <Fragment key={m.id}>
              {showSep && <DateSeparator at={new Date(m.created_at)} />}
              <MessageBubble
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
            </Fragment>
          );
        })
      )}
    </div>
    <MediaPicker
      open={mediaPickerOpen}
      jwt={jwt}
      studentId={studentId}
      onClose={() => setMediaPickerOpen(false)}
      onSent={async () => {
        setMediaPickerOpen(false);
        await load();
      }}
    />
    </PlaybackProvider>
  );
}

function PaperclipIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
