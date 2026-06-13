import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";
import { getSignedRemainingForManyToday } from "@/server/quota";
import type { MessageKind } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MessageRow {
  id: number;
  student_id: number;
  direction: "in" | "out";
  kind: MessageKind;
  duration: number;
  status: "pending" | "answered" | "expired" | "orphaned";
  teacher_id: number | null;
  created_at: string;
  text_content: string | null;
  media_library_id: number | null;
}

interface InboxChat {
  student_id: number;
  student_handle: string;
  student_emoji: string | null;
  student_has_avatar: boolean;
  last_message:
    | {
        id: number;
        direction: "in" | "out";
        kind: MessageKind;
        duration: number;
        status: "pending" | "answered" | "expired" | "orphaned";
        teacher_id: number | null;
        created_at: string;
        text_content: string | null;
        /** For a media-library send (kind photo/video/audio), the library item's
         * title so the chat-list preview can show what was sent. */
        media_title: string | null;
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
  /**
   * Admin-only signal: this student isn't linked to any teacher in
   * `student_teachers`. Drives the "без тренера" badge + assign-teacher
   * dialog in the admin inbox. Always `false` in a teacher's payload (they
   * only see students they're already linked to).
   */
  has_no_teacher: boolean;
  claim:
    | {
        teacher_id: number;
        teacher_handle: string;
        teacher_emoji: string | null;
        teacher_has_avatar: boolean;
        is_self: boolean;
      }
    | null;
  /**
   * Signed seconds remaining on this student's daily voice/video-note quota.
   * Negative = over by abs(value). Drives the tutor-facing <QuotaPill>.
   */
  quota_remaining_seconds: number;
}

// (Display resolution now lives in src/server/display.ts and is mode-aware:
// names vs anonymous handles per the global app_settings flag.)

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

  // For the admin oversight view, mark which students currently have no
  // teacher in student_teachers — drives the inbox "без тренера" badge.
  // For teachers, this is always false (their studentIds come from their
  // own links). One query over the admin's student set; small N.
  const studentsWithTeacherSet = new Set<number>();
  if (user.isAdmin) {
    const { data: linkRows } = await sb
      .from("student_teachers")
      .select("student_id")
      .in("student_id", studentIds);
    for (const row of linkRows ?? []) {
      studentsWithTeacherSet.add(row.student_id);
    }
  }

  // 2) Recent message slice across all my linked students.
  const { data: msgsRaw } = await sb
    .from("messages")
    .select(
      "id, student_id, direction, kind, duration, status, teacher_id, created_at, text_content, media_library_id",
    )
    .in("student_id", studentIds)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: false })
    .limit(500);
  const msgs = (msgsRaw ?? []) as MessageRow[];

  // 3) Linked-student rows (handles + emoji for the anonymous chat surface).
  const { data: studentRows } = await sb
    .from("users")
    .select("id, tg_user_id, display_handle, display_emoji, name, preferred_name, avatar_file_id")
    .in("id", studentIds);

  // Mode picks names-vs-handles for every peer-facing field below.
  const anonMode = await getDisplayAnonymousHandlesEnabled();

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
    {
      teacher_id: number;
      teacher_handle: string;
      teacher_emoji: string | null;
      teacher_has_avatar: boolean;
    }
  >();
  if (claimRows && claimRows.length > 0) {
    const claimTeacherIds = Array.from(new Set(claimRows.map((c) => c.teacher_id)));
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, tg_user_id, display_handle, display_emoji, name, preferred_name, avatar_file_id")
      .in("id", claimTeacherIds);
    const teacherById = new Map(
      (teacherRows ?? []).map((t) => [t.id, t]),
    );
    for (const c of claimRows) {
      const d = resolveDisplay(teacherById.get(c.teacher_id), anonMode);
      claimByStudent.set(c.student_id, {
        teacher_id: c.teacher_id,
        teacher_handle: d.handle,
        teacher_emoji: d.emoji,
        teacher_has_avatar: d.has_avatar,
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

  // Titles for any media-library item that is a thread's LAST message, so the
  // chat-list preview can show "what was sent" instead of a bare icon. Only the
  // last message per student, so N is tiny.
  const lastLibIds = Array.from(
    new Set(
      [...lastByStudent.values()]
        .map((m) => m.media_library_id)
        .filter((v): v is number => v != null),
    ),
  );
  const libTitleById = new Map<number, string | null>();
  if (lastLibIds.length > 0) {
    const { data: libRows } = await sb
      .from("media_library")
      .select("id, title")
      .in("id", lastLibIds);
    for (const l of libRows ?? []) libTitleById.set(l.id, l.title);
  }

  const studentById = new Map(
    (studentRows ?? []).map((s) => [s.id, s]),
  );

  const quotaRemainingByStudent = await getSignedRemainingForManyToday(studentIds);

  const chats: InboxChat[] = studentIds
    .map((sid): InboxChat => {
      const s = studentById.get(sid);
      const last = lastByStudent.get(sid) ?? null;
      const claim = claimByStudent.get(sid) ?? null;
      const studentDisplay = resolveDisplay(s, anonMode);
      return {
        student_id: sid,
        student_handle: studentDisplay.handle,
        student_emoji: studentDisplay.emoji,
        student_has_avatar: studentDisplay.has_avatar,
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
              media_title:
                last.media_library_id != null
                  ? libTitleById.get(last.media_library_id) ?? null
                  : null,
            }
          : null,
        unread_count: unreadByStudent.get(sid) ?? 0,
        has_unanswered:
          last !== null && last.direction === "in" && last.status !== "answered",
        has_no_teacher: user.isAdmin ? !studentsWithTeacherSet.has(sid) : false,
        claim: claim
          ? {
              teacher_id: claim.teacher_id,
              teacher_handle: claim.teacher_handle,
              teacher_emoji: claim.teacher_emoji,
              teacher_has_avatar: claim.teacher_has_avatar,
              is_self: claim.teacher_id === user.id,
            }
          : null,
        quota_remaining_seconds: quotaRemainingByStudent.get(sid) ?? 0,
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
