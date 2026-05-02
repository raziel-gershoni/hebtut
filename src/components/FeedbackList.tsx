"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { useRealtimeFeedback } from "@/hooks/useRealtimeFeedback";

interface ChatRow {
  user: {
    id: number;
    name: string | null;
    display_handle: string | null;
    display_emoji: string | null;
    tg_username: string | null;
    tg_user_id: number;
    has_avatar: boolean;
  };
  last_message: {
    direction: "in" | "out";
    text_content: string;
    created_at: string;
  };
  unread_count: number;
  claim: { admin_id: number; admin_handle: string; is_self: boolean } | null;
}

function formatRel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function FeedbackList({ jwt }: { jwt: string }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/feedback", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { chats: ChatRow[] };
      setChats(d.chats);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeFeedback(jwt, load);

  if (!loaded) {
    return (
      <ul className="space-y-2 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="h-16 rounded-2xl bg-tg-bg-secondary" />
        ))}
      </ul>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
        Никто пока не писал в обратную связь.
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {chats.map((c) => {
        const u = c.user;
        const avatarUrl = u.has_avatar
          ? `/api/avatar/${u.id}?token=${encodeURIComponent(jwt)}`
          : undefined;
        const name = u.name ?? `user ${u.tg_user_id}`;
        const fromMe = c.last_message.direction === "out";
        return (
          <li key={u.id}>
            <Link
              href={`/admin/feedback/${u.id}`}
              className={`flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors active:bg-tg-bg-secondary/60 ${
                c.unread_count > 0 ? "border-l-2 border-tg-text-accent/50 pl-[14px]" : ""
              }`}
            >
              <Avatar name={name} imageUrl={avatarUrl} size={48} isAdmin={false} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium tracking-tight truncate">{name}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-tg-text-hint">
                    {formatRel(c.last_message.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-tg-text-hint">
                    {fromMe && "Ты: "}
                    {c.last_message.text_content}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-tg-button text-tg-button-text text-[11px] font-semibold tabular-nums">
                      {c.unread_count}
                    </span>
                  )}
                </div>
                {(u.display_handle || u.tg_username) && (
                  <div className="mt-0.5 text-[11px] text-tg-text-hint truncate">
                    {u.tg_username && <span>@{u.tg_username}</span>}
                    {u.tg_username && u.display_handle && <span aria-hidden> · </span>}
                    {u.display_handle && (
                      <span>
                        {u.display_emoji} {u.display_handle}
                      </span>
                    )}
                  </div>
                )}
                {c.claim && (
                  <div
                    className={`mt-0.5 text-[11px] truncate ${
                      c.claim.is_self ? "text-emerald-600 dark:text-emerald-400" : "text-tg-text-hint"
                    }`}
                  >
                    {c.claim.is_self ? "Берёшь ты" : `Берёт ${c.claim.admin_handle}`}
                  </div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
