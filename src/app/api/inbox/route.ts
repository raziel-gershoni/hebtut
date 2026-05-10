import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MessageRow {
  id: number;
  student_id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note" | "text";
  duration: number;
  status: "pending" | "answered" | "expired" | "orphaned";
  teacher_id: number | null;
  created_at: string;
  text_content: string | null;
}

interface InboxChat {
  student_id: number;
  student_handle: string;
  student_emoji: string;
  last_message:
    | {
        id: number;
        direction: "in" | "out";
        kind: "voice" | "video_note" | "text";
        duration: number;
        status: "pending" | "answered" | "expired" | "orphaned";
        teacher_id: number | null;
        created_at: string;
        text_content: string | null;
      }
    | null;
  unread_count: number;
  /**
   * True when the latest message in the thread is an unanswered student
   * message — i.e. the conversation tail is "student spoke, no reply yet."
   * This is tighter than "any inbound is pending": a single stale pending
   * row buried in the history doesn't keep the badge lit forever after the
   * thread has moved on.
   */
  has_unanswered: boolean;
  claim:
    | { teacher_id: number; teacher_handle: string; teacher_emoji: string; is_self: boolean }
    | null;
}

function resolveHandle(
  row: { tg_user_id: number; display_handle: string | null; display_emoji: string | null } | undefined,
): { handle: string; emoji: string } {
  if (row?.display_handle && row.display_emoji) {
    return { handle: row.display_handle, emoji: row.display_emoji };
  }
  // Legacy NULL fallback — derive from tg_user_id. Same algorithm the bot
  // and the admin route use, so the value matches once the lazy backfill
  // commits in /api/admin/users.
  const fallbackTgId = row?.tg_user_id ?? 0;
  const h = userHandle(fallbackTgId);
  return { handle: h.handle, emoji: h.emoji };
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  // 1) Which students does this viewer see?
  // - Admin (with or without teacher role): every student in the system
  //   (read-only oversight). Bypasses the student_teachers join entirely.
  // - Teacher: only their linked students.
  // unread_count is keyed on (teacher_id, student_id) in inbox_reads, so an
  // admin who isn't linked to a given student will see unread_count=0 for
  // that thread — matches the desired UX (oversight view, no personal
  // read-state to maintain).
  let studentIds: number[];
  if (user.isAdmin) {
    const { data: students } = await sb
      .from("users")
      .select("id")
      .eq("role", "student");
    studentIds = (students ?? []).map((u) => u.id);
  } else {
    const { data: links } = await sb
      .from("student_teachers")
      .select("student_id")
      .eq("teacher_id", user.id);
    studentIds = (links ?? []).map((l) => l.student_id);
  }
  if (studentIds.length === 0) {
    return Response.json({ chats: [] }, { headers: noStoreHeaders });
  }

  // 2) Recent message slice across all my linked students.
  const { data: msgsRaw } = await sb
    .from("messages")
    .select(
      "id, student_id, direction, kind, duration, status, teacher_id, created_at, text_content",
    )
    .in("student_id", studentIds)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: false })
    .limit(500);
  const msgs = (msgsRaw ?? []) as MessageRow[];

  // 3) Linked-student rows (handles + emoji for the anonymous chat surface).
  const { data: studentRows } = await sb
    .from("users")
    .select("id, tg_user_id, display_handle, display_emoji")
    .in("id", studentIds);

  // 4) Inbox-read marks for me.
  const { data: readRows } = await sb
    .from("inbox_reads")
    .select("student_id, last_seen_at")
    .eq("teacher_id", user.id)
    .in("student_id", studentIds);
  const lastSeenByStudent = new Map<number, string>(
    (readRows ?? []).map((r) => [r.student_id, r.last_seen_at]),
  );

  // 5) Active claims for these students.
  const nowIso = new Date().toISOString();
  const { data: claimRows } = await sb
    .from("claims")
    .select("student_id, teacher_id, expires_at")
    .in("student_id", studentIds)
    .gt("expires_at", nowIso);
  const claimByStudent = new Map<
    number,
    { teacher_id: number; teacher_handle: string; teacher_emoji: string }
  >();
  if (claimRows && claimRows.length > 0) {
    const claimTeacherIds = Array.from(new Set(claimRows.map((c) => c.teacher_id)));
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, tg_user_id, display_handle, display_emoji")
      .in("id", claimTeacherIds);
    const teacherById = new Map(
      (teacherRows ?? []).map((t) => [t.id, t]),
    );
    for (const c of claimRows) {
      const h = resolveHandle(teacherById.get(c.teacher_id));
      claimByStudent.set(c.student_id, {
        teacher_id: c.teacher_id,
        teacher_handle: h.handle,
        teacher_emoji: h.emoji,
      });
    }
  }

  // Reduce per-student in JS — small N.
  // msgs is already ordered DESC by created_at (the .order("created_at",
  // { ascending: false }) above), so the FIRST seen message per student_id
  // is the most recent one in that thread.
  const lastByStudent = new Map<number, MessageRow>();
  const unreadByStudent = new Map<number, number>();
  for (const m of msgs) {
    if (!lastByStudent.has(m.student_id)) lastByStudent.set(m.student_id, m);
    if (m.direction === "in") {
      const ls = lastSeenByStudent.get(m.student_id);
      const isUnread = !ls || new Date(m.created_at).getTime() > new Date(ls).getTime();
      if (isUnread) {
        unreadByStudent.set(m.student_id, (unreadByStudent.get(m.student_id) ?? 0) + 1);
      }
    }
  }

  const studentById = new Map(
    (studentRows ?? []).map((s) => [s.id, s]),
  );

  const chats: InboxChat[] = studentIds
    .map((sid): InboxChat => {
      const s = studentById.get(sid);
      const last = lastByStudent.get(sid) ?? null;
      const claim = claimByStudent.get(sid) ?? null;
      const studentHandle = resolveHandle(s);
      return {
        student_id: sid,
        student_handle: studentHandle.handle,
        student_emoji: studentHandle.emoji,
        last_message: last
          ? {
              id: last.id,
              direction: last.direction,
              kind: last.kind,
              duration: last.duration,
              status: last.status,
              teacher_id: last.teacher_id,
              created_at: last.created_at,
              text_content: last.text_content,
            }
          : null,
        unread_count: unreadByStudent.get(sid) ?? 0,
        has_unanswered:
          last !== null && last.direction === "in" && last.status !== "answered",
        claim: claim
          ? {
              teacher_id: claim.teacher_id,
              teacher_handle: claim.teacher_handle,
              teacher_emoji: claim.teacher_emoji,
              is_self: claim.teacher_id === user.id,
            }
          : null,
      };
    })
    // TG hides empty conversations from the chat list — match.
    .filter((c) => c.last_message !== null)
    .sort((a, b) => {
      const at = a.last_message?.created_at ?? "";
      const bt = b.last_message?.created_at ?? "";
      return bt.localeCompare(at);
    });

  return Response.json({ chats }, { headers: noStoreHeaders });
}
