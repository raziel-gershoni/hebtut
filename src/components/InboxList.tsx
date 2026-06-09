"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { StudentPicker } from "./StudentPicker";
import { AssignTeacherDialog } from "./AssignTeacherDialog";
import { QuotaPill } from "./QuotaPill";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { formatDuration, ru } from "@/lib/i18n";
import { bgFromHandle } from "@/lib/handle";
import { PAUSE_INACTIVITY_MS } from "@/lib/time";

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
  // Anonymous mode populates emoji; names mode leaves it null (use avatar
  // when has_avatar=true, else fall back to initials).
  student_emoji: string | null;
  student_has_avatar: boolean;
  last_message: LastMessage | null;
  unread_count: number;
  has_unanswered: boolean;
  // Admin-only flag — true when this student has no row in student_teachers.
  // Teachers always see this as false (their inbox is filtered to their own
  // linked students).
  has_no_teacher: boolean;
  claim: {
    teacher_id: number;
    teacher_handle: string;
    teacher_emoji: string | null;
    teacher_has_avatar: boolean;
    is_self: boolean;
  } | null;
  /**
   * Mirror of /api/inbox `quota_remaining_seconds`. Optional on the client
   * so an old server response (without the field) doesn't blow up — treated
   * as no-pill in that case.
   */
  quota_remaining_seconds?: number;
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
  const [assigningStudentId, setAssigningStudentId] = useState<number | null>(null);

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

  // Honor the ?focus_student=<id> deep link from the admin DM fan-out
  // (`fanOutUnassignedToAdmins` in src/server/notifications.ts). When the
  // inbox has loaded and the matching chat is unassigned, auto-open the
  // assignment dialog. Run once per `loaded` flip to avoid re-opening if
  // the user manually closed it.
  useEffect(() => {
    if (!loaded || assigningStudentId != null) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("focus_student");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    const chat = chats.find((c) => c.student_id === id);
    if (chat?.has_no_teacher) setAssigningStudentId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function closeAssignDialog() {
    setAssigningStudentId(null);
    // Clear the query param so a tab-refresh doesn't re-open the dialog.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("focus_student")) {
        url.searchParams.delete("focus_student");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }

  async function onAssignSaved() {
    closeAssignDialog();
    await load();
  }

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
            {ru.inbox.row.newClaimAction}
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
          {ru.inbox.inboxPage.empty}
        </div>
      ) : (
        <ul className="space-y-1">
          {chats.map((c) => (
            <ChatRow
              key={c.student_id}
              chat={c}
              jwt={jwt}
              myUserId={myUserId}
              onAssignClick={() => setAssigningStudentId(c.student_id)}
            />
          ))}
        </ul>
      )}

      {pickerOpen && <StudentPicker jwt={jwt} onClose={() => setPickerOpen(false)} />}
      {assigningStudentId != null && (() => {
        const target = chats.find((c) => c.student_id === assigningStudentId);
        if (!target) return null;
        return (
          <AssignTeacherDialog
            open
            jwt={jwt}
            studentId={target.student_id}
            studentLabel={target.student_handle}
            onClose={closeAssignDialog}
            onSaved={() => void onAssignSaved()}
          />
        );
      })()}
    </>
  );
}

type StatusDot = "red" | "orange" | null;

/**
 * Decides whether the chat row should show a status indicator on the avatar.
 *   red    → student is waiting for a teacher (last message is inbound + not
 *            yet answered). Uses the server-computed `has_unanswered` flag.
 *   orange → teacher has replied, but the student hasn't followed up within
 *            `PAUSE_INACTIVITY_MS` (mirrors the bot's pause-nudge gate).
 *   null   → either no message yet, or the chat is in a healthy state.
 */
function computeStatusDot(chat: Chat): StatusDot {
  const last = chat.last_message;
  if (!last) return null;
  if (chat.has_unanswered) return "red";
  if (last.direction === "out") {
    const ageMs = Date.now() - new Date(last.created_at).getTime();
    if (ageMs > PAUSE_INACTIVITY_MS) return "orange";
  }
  return null;
}

function ChatRow({
  chat,
  jwt,
  myUserId,
  onAssignClick,
}: {
  chat: Chat;
  jwt: string;
  myUserId: number;
  onAssignClick: () => void;
}) {
  const name = chat.student_handle;
  const time = chat.last_message ? formatChatTimestamp(chat.last_message.created_at) : "";
  const heldByOther = chat.claim && !chat.claim.is_self;
  const dot = computeStatusDot(chat);
  // Names mode: server returns emoji=null; if student_has_avatar, construct
  // the TG photo URL. Anon mode: emoji is set, no avatar. Avatar component
  // prefers imageUrl over emoji; the bgClass only matters as the emoji-circle
  // background, so passing it unconditionally is fine.
  const imageUrl =
    chat.student_emoji == null && chat.student_has_avatar
      ? `/api/avatar/${chat.student_id}?token=${encodeURIComponent(jwt)}`
      : undefined;

  return (
    <li>
      <Link
        href={`/students/${chat.student_id}`}
        className="flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors active:bg-tg-bg-secondary/60"
      >
        <div className="relative shrink-0">
          <Avatar
            name={name}
            imageUrl={imageUrl}
            emoji={chat.student_emoji ?? undefined}
            bgClass={chat.student_emoji ? bgFromHandle(chat.student_handle) : undefined}
            size={48}
          />
          {dot && (
            <span
              aria-label={
                dot === "red"
                  ? ru.inbox.row.unansweredAria
                  : ru.inbox.row.studentInactiveAria
              }
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-tg-bg-primary ${
                dot === "red" ? "bg-red-500" : "bg-orange-500"
              }`}
            />
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="font-medium tracking-tight truncate">{name}</span>
            {chat.has_no_teacher && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAssignClick();
                }}
                className="shrink-0 inline-flex items-center h-5 px-2 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-semibold uppercase tracking-wide transition-opacity active:opacity-70"
              >
                {ru.inbox.row.noTeacherBadge}
              </button>
            )}
            {chat.quota_remaining_seconds != null && (
              <span className="ml-auto shrink-0">
                <QuotaPill remainingSeconds={chat.quota_remaining_seconds} />
              </span>
            )}
            {time && (
              <span
                className={`${chat.quota_remaining_seconds != null ? "" : "ml-auto "}shrink-0 text-[11px] tabular-nums text-tg-text-hint`}
              >
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
              {ru.inbox.thread.takingByOtherFn(chat.claim!.teacher_handle)}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function Preview({ chat, myUserId }: { chat: Chat; myUserId: number }) {
  const m = chat.last_message;
  if (!m) return <span>{ru.inbox.row.preview.empty}</span>;
  // "Ты:" only when the LAST out-message was sent by the viewer. With
  // multi-teacher threads, a peer's reply must not be misattributed.
  const prefix =
    m.direction === "out" && m.teacher_id === myUserId ? ru.inbox.row.preview.youPrefix : "";
  const tail = chat.has_unanswered ? ru.inbox.row.preview.awaitsReply : "";
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
  const icon = m.kind === "voice" ? "🎙️" : "🎥";
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
  if (wasYesterday) return ru.inbox.dateSeparator.yesterday;

  const diffMs = now.getTime() - d.getTime();
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  if (diffMs < SEVEN_DAYS) {
    return d.toLocaleDateString("ru-RU", { weekday: "short" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
