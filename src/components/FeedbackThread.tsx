"use client";
import { ru } from "@/lib/i18n";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { DateSeparator } from "./DateSeparator";
import { useRealtimeFeedback } from "@/hooks/useRealtimeFeedback";

interface AuthorRef {
  id: number;
  /** Pre-resolved display label (real/preferred name in names mode,
   *  animal handle in anon mode). Server picks via resolveDisplay. */
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

interface ClaimInfo {
  admin_id: number;
  admin_handle: string;
  is_self: boolean;
  expires_at: string;
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
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
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
      const d = (await r.json()) as {
        user: UserMeta;
        messages: FeedbackMessage[];
        claim: ClaimInfo | null;
      };
      setUser(d.user);
      setMessages(d.messages);
      setClaim(d.claim);
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

  // Auto-claim on mount: if no other admin holds it, take ownership so the
  // input is enabled. If another admin holds it, the API returns 409 with
  // the holder's handle and the input stays disabled until that claim
  // expires (or is released by the cron).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/admin/feedback/${userId}/claim`, {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (cancelled) return;
      // The realtime subscription will deliver the new claim row to load(),
      // but call it directly so the UI updates without waiting for the round-trip.
      await load();
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as {
          reason?: string;
          holder?: { handle?: string };
        };
        if (d.reason === "taken-by-other" && d.holder?.handle) {
          setError(null); // banner handles it; not a true error
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jwt, userId, load]);

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
      } else if (r.status === 409) {
        const d = (await r.json().catch(() => ({}))) as {
          holder?: { handle?: string };
        };
        const h = d.holder?.handle ?? ru.inbox.feedbackThread.fallbackHandler;
        setError(ru.inbox.feedbackThread.takenByOtherFn(h));
        await load();
      } else {
        setError(ru.inbox.feedbackThread.sendError);
      }
    } finally {
      setSending(false);
    }
  }

  const avatarUrl =
    user?.has_avatar && jwt
      ? `/api/avatar/${user.id}?token=${encodeURIComponent(jwt)}`
      : undefined;
  const name = user?.name ?? ru.inbox.feedbackThread.fallbackName;

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] sm:h-[70vh]">
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
            {ru.inbox.feedbackThread.noMessages}
          </div>
        )}
        {messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const showSep =
            !prev ||
            differenceInCalendarDays(new Date(m.created_at), new Date(prev.created_at)) !== 0;
          // user-direction messages = from user to admin pool. Display left-aligned.
          // out-direction = from an admin. Display right-aligned (us / our pool).
          if (m.direction === "in") {
            return (
              <Fragment key={m.id}>
                {showSep && <DateSeparator at={new Date(m.created_at)} />}
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-tg-bg-section border-l-[3px] border-sky-500">
                    <div className="text-xs whitespace-pre-wrap break-words">
                      {m.text_content}
                    </div>
                    <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint">
                      {formatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          }
          const author = m.author;
          return (
            <Fragment key={m.id}>
              {showSep && <DateSeparator at={new Date(m.created_at)} />}
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-emerald-500/15 border-r-[3px] border-emerald-500">
                  {author && (
                    <div className="text-[11px] mb-1 font-semibold text-emerald-700 dark:text-emerald-400">
                      {author.handle}
                    </div>
                  )}
                  <div className="text-xs whitespace-pre-wrap break-words">{m.text_content}</div>
                  <div className="mt-1 text-[10px] tabular-nums text-tg-text-hint text-right">
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {claim && !claim.is_self && (
        <div className="mb-2 text-xs text-tg-text-hint bg-tg-bg-section rounded-xl px-3 py-2 shrink-0">
          Сейчас отвечает {claim.admin_handle}. Подожди или попробуй позже — клейм истекает автоматически.
        </div>
      )}

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
          placeholder={claim && !claim.is_self ? ru.inbox.feedbackThread.takenByPlaceholderFn(claim.admin_handle) : ru.inbox.feedbackThread.draftPlaceholder}
          disabled={!!(claim && !claim.is_self)}
          className="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-tg-bg-secondary text-tg-text text-sm placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40 resize-none max-h-32 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0 || !!(claim && !claim.is_self)}
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-tg-button text-tg-button-text font-semibold transition-transform active:scale-95 disabled:opacity-50"
          aria-label={ru.inbox.feedbackThread.sendAriaLabel}
        >
          {sending ? <Spinner size={14} /> : "↑"}
        </button>
      </div>
    </div>
  );
}
