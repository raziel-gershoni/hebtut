"use client";
import { ru } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { useRealtimeFeedback } from "@/hooks/useRealtimeFeedback";
import { bgFromHandle } from "@/lib/handle";

interface FeedbackMessage {
  id: number;
  direction: "in" | "out";
  text_content: string;
  created_at: string;
  author: { handle: string } | null;
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

export function FeedbackChat({ jwt }: { jwt: string }) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/feedback", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { messages: FeedbackMessage[] };
      setMessages(d.messages);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark admin replies as read on mount.
  useEffect(() => {
    void fetch("/api/feedback/seen", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }, [jwt]);

  useRealtimeFeedback(jwt, load);

  // Autoscroll to bottom when messages change.
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
      const r = await fetch("/api/feedback", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (r.ok) {
        setDraft("");
        await load();
      } else {
        setError(ru.inbox.feedbackChat.sendError);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] sm:h-[70vh]">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-2 mb-3 pr-1"
      >
        {!loaded && (
          <div className="space-y-2 animate-pulse">
            <div className="h-12 w-3/4 rounded-2xl bg-tg-bg-secondary" />
            <div className="h-12 w-3/4 ml-auto rounded-2xl bg-tg-bg-secondary" />
          </div>
        )}
        {loaded && messages.length === 0 && (
          <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
            {ru.inbox.feedbackChat.emptyState}
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.direction === "in";
          if (isMine) {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-amber-500/15 border-r-[3px] border-amber-500">
                  <div className="text-xs whitespace-pre-wrap break-words">{m.text_content}</div>
                  <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint text-right">
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          }
          const handle = m.author?.handle ?? ru.inbox.feedbackChat.adminFallback;
          return (
            <div key={m.id} className="flex items-start gap-2">
              <div className="shrink-0 mt-1.5">
                <Avatar
                  size={32}
                  name={handle}
                  emoji={"👑"}
                  bgClass={bgFromHandle(handle)}
                />
              </div>
              <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-tg-bg-section border-l-[3px] border-tg-text-accent/40">
                <div className="text-[11px] mb-1 font-semibold text-tg-text-accent">{handle}</div>
                <div className="text-xs whitespace-pre-wrap break-words">{m.text_content}</div>
                <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint">
                  {formatTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="mb-2 text-xs text-tg-text-destructive">{error}</div>}

      <div className="flex items-end gap-2 shrink-0 pb-[env(safe-area-inset-bottom)]">
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
          placeholder={ru.inbox.feedbackChat.messagePlaceholder}
          className="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-tg-bg-secondary text-tg-text text-sm placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40 resize-none max-h-32"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-tg-button text-tg-button-text font-semibold transition-transform active:scale-95 disabled:opacity-50"
          aria-label={ru.inbox.feedbackChat.sendAriaLabel}
        >
          {sending ? <Spinner size={14} /> : "↑"}
        </button>
      </div>
    </div>
  );
}
