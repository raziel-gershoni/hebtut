"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { StudentPicker } from "./StudentPicker";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { formatDuration } from "@/lib/i18n";
import { bgFromHandle } from "@/lib/handle";

type LastMessage = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note" | "text";
  duration: number;
  status: "pending" | "answered" | "expired" | "orphaned";
  teacher_id: number | null;
  created_at: string;
  text_content?: string | null;
};

interface Chat {
  student_id: number;
  student_handle: string;
  student_emoji: string;
  last_message: LastMessage | null;
  unread_count: number;
  has_unanswered: boolean;
  claim: {
    teacher_id: number;
    teacher_handle: string;
    teacher_emoji: string;
    is_self: boolean;
  } | null;
}

export function InboxList({
  jwt,
  myUserId,
  role,
}: {
  jwt: string;
  myUserId: number;
  role: string;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/inbox", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) {
      setLoaded(true);
      return;
    }
    const d = (await r.json()) as { chats: Chat[] };
    setChats(d.chats);
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeMessages(jwt, load);

  const isTeacher = role === "teacher";

  return (
    <>
      {isTeacher && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-95"
          >
            + Написать ученику
          </button>
        </div>
      )}

      {!loaded ? (
        <ul className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-16 rounded-2xl bg-tg-bg-secondary" />
          ))}
        </ul>
      ) : chats.length === 0 ? (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          Пока ничего нет. Сюда придут сообщения от твоих учеников.
        </div>
      ) : (
        <ul className="space-y-1">
          {chats.map((c) => (
            <ChatRow key={c.student_id} chat={c} jwt={jwt} myUserId={myUserId} />
          ))}
        </ul>
      )}

      {pickerOpen && <StudentPicker jwt={jwt} onClose={() => setPickerOpen(false)} />}
    </>
  );
}

function ChatRow({
  chat,
  jwt,
  myUserId,
}: {
  chat: Chat;
  jwt: string;
  myUserId: number;
}) {
  void jwt;
  const name = chat.student_handle;
  const time = chat.last_message ? formatChatTimestamp(chat.last_message.created_at) : "";
  const unanswered = chat.has_unanswered;
  const heldByOther = chat.claim && !chat.claim.is_self;

  return (
    <li>
      <Link
        href={`/students/${chat.student_id}`}
        className={`flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors active:bg-tg-bg-secondary/60 ${
          unanswered ? "border-l-2 border-tg-text-accent/50 pl-[14px]" : ""
        }`}
      >
        <Avatar
          name={name}
          emoji={chat.student_emoji}
          bgClass={bgFromHandle(chat.student_handle)}
          size={48}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="font-medium tracking-tight truncate">{name}</span>
            {time && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-tg-text-hint">
                {time}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-tg-text-hint">
              <Preview chat={chat} myUserId={myUserId} />
            </span>
            {chat.unread_count > 0 && (
              <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-tg-button text-tg-button-text text-[11px] font-semibold tabular-nums">
                {chat.unread_count}
              </span>
            )}
          </div>
          {heldByOther && (
            <div className="mt-0.5 text-[11px] text-tg-text-hint">
              Берёт {chat.claim!.teacher_handle}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function Preview({ chat, myUserId }: { chat: Chat; myUserId: number }) {
  const m = chat.last_message;
  if (!m) return <span>Пока пусто</span>;
  // "Ты:" only when the LAST out-message was sent by the viewer. With
  // multi-teacher threads, a peer's reply must not be misattributed.
  const prefix =
    m.direction === "out" && m.teacher_id === myUserId ? "Ты: " : "";
  const tail = chat.has_unanswered ? " · ждёт ответа" : "";
  if (m.kind === "text") {
    // Text-message preview: show a short snippet, truncated. The CSS truncate
    // on the parent already clips visually; we trim here too for safety.
    const snippet = (m.text_content ?? "").slice(0, 80);
    return (
      <span>
        {prefix}
        {snippet}
        {tail}
      </span>
    );
  }
  const icon = m.kind === "voice" ? "🎙️" : "🟢";
  const dur = formatDuration(m.duration);
  return (
    <span>
      {prefix}
      {icon} {dur}
      {tail}
    </span>
  );
}

/**
 * TG-style relative timestamp.
 * Today → HH:MM
 * Yesterday → "Вчера"
 * This week (within last 7 days) → short weekday (пн/вт/…)
 * Older → DD.MM
 */
function formatChatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (wasYesterday) return "Вчера";

  const diffMs = now.getTime() - d.getTime();
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  if (diffMs < SEVEN_DAYS) {
    return d.toLocaleDateString("ru-RU", { weekday: "short" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
