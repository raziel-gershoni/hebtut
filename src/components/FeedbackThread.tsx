"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { useRealtimeFeedback } from "@/hooks/useRealtimeFeedback";

interface AuthorRef {
  id: number;
  name: string | null;
  handle: string;
}

interface FeedbackMessage {
  id: number;
  direction: "in" | "out";
  text_content: string;
  created_at: string;
  author: AuthorRef | null;
}

interface UserMeta {
  id: number;
  name: string | null;
  display_handle: string | null;
  display_emoji: string | null;
  tg_username: string | null;
  tg_user_id: number;
  has_avatar: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedbackThread({
  jwt,
  userId,
}: {
  jwt: string;
  userId: number;
}) {
  const [user, setUser] = useState<UserMeta | null>(null);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/feedback/${userId}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { user: UserMeta; messages: FeedbackMessage[] };
      setUser(d.user);
      setMessages(d.messages);
    }
    setLoaded(true);
  }, [jwt, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark inbound messages as read on mount.
  useEffect(() => {
    void fetch(`/api/admin/feedback/${userId}/seen`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }, [jwt, userId]);

  useRealtimeFeedback(jwt, load);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/feedback/${userId}/reply`, {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (r.ok) {
        setDraft("");
        await load();
      } else {
        setError("Не удалось отправить — попробуй ещё раз");
      }
    } finally {
      setSending(false);
    }
  }

  const avatarUrl =
    user?.has_avatar && jwt
      ? `/api/avatar/${user.id}?token=${encodeURIComponent(jwt)}`
      : undefined;
  const name = user?.name ?? "—";

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] sm:h-[70vh]">
      {user && (
        <header className="flex items-center gap-3 mb-3 pb-3 border-b border-tg-text-hint/15 shrink-0">
          <Avatar size={48} name={name} imageUrl={avatarUrl} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-semibold tracking-tight truncate">{name}</div>
            <div className="mt-0.5 text-[11px] text-tg-text-hint truncate">
              {user.tg_username && <span>@{user.tg_username}</span>}
              {user.tg_username && user.display_handle && <span aria-hidden> · </span>}
              {user.display_handle && (
                <span>
                  {user.display_emoji} {user.display_handle}
                </span>
              )}
            </div>
          </div>
        </header>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 mb-3 pr-1">
        {!loaded && (
          <div className="space-y-2 animate-pulse">
            <div className="h-12 w-3/4 rounded-2xl bg-tg-bg-secondary" />
            <div className="h-12 w-3/4 ml-auto rounded-2xl bg-tg-bg-secondary" />
          </div>
        )}
        {loaded && messages.length === 0 && (
          <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
            Сообщений нет.
          </div>
        )}
        {messages.map((m) => {
          // user-direction messages = from user to admin pool. Display left-aligned.
          // out-direction = from an admin. Display right-aligned (us / our pool).
          if (m.direction === "in") {
            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-tg-bg-section border-l-[3px] border-sky-500">
                  <div className="text-xs whitespace-pre-wrap break-words">
                    {m.text_content}
                  </div>
                  <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint">
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          }
          const author = m.author;
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-emerald-500/15 border-r-[3px] border-emerald-500">
                {author && (
                  <div className="text-[11px] mb-1 font-semibold text-emerald-700 dark:text-emerald-400">
                    {author.name ?? author.handle}
                  </div>
                )}
                <div className="text-xs whitespace-pre-wrap break-words">{m.text_content}</div>
                <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint text-right">
                  {formatTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="mb-2 text-xs text-tg-text-destructive">{error}</div>}

      <div className="flex items-end gap-2 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Ответ"
          className="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-tg-bg-secondary text-tg-text text-sm placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40 resize-none max-h-32"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-tg-button text-tg-button-text font-semibold transition-transform active:scale-95 disabled:opacity-50"
          aria-label="Отправить"
        >
          {sending ? <Spinner size={14} /> : "↑"}
        </button>
      </div>
    </div>
  );
}
