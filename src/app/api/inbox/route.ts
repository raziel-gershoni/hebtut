import type { NextRequest } from "next/server";
import { authFromRequest, canTeachOrReadAsAdmin } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MessageRow {
  id: number;
  student_id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  status: "pending" | "answered" | "expired" | "orphaned";
  created_at: string;
}

interface InboxChat {
  student_id: number;
  student_name: string | null;
  has_avatar: boolean;
  last_message:
    | {
        id: number;
        direction: "in" | "out";
        kind: "voice" | "video_note";
        duration: number;
        status: "pending" | "answered" | "expired" | "orphaned";
        created_at: string;
      }
    | null;
  unread_count: number;
  has_unanswered: boolean;
  claim:
    | { teacher_id: number; teacher_name: string; is_self: boolean }
    | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!canTeachOrReadAsAdmin(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();

  // 1) My linked students.
  const { data: links } = await sb
    .from("student_teachers")
    .select("student_id")
    .eq("teacher_id", user.id);
  const studentIds = (links ?? []).map((l) => l.student_id);
  if (studentIds.length === 0) {
    return Response.json({ chats: [] }, { headers: noStoreHeaders });
  }

  // 2) Recent message slice across all my linked students.
  const { data: msgsRaw } = await sb
    .from("messages")
    .select("id, student_id, direction, kind, duration, status, created_at")
    .in("student_id", studentIds)
    .in("status", ["pending", "answered", "expired"])
    .order("created_at", { ascending: false })
    .limit(500);
  const msgs = (msgsRaw ?? []) as MessageRow[];

  // 3) Linked-student rows (names + avatar presence).
  const { data: studentRows } = await sb
    .from("users")
    .select("id, name, avatar_file_id")
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
    { teacher_id: number; teacher_name: string }
  >();
  if (claimRows && claimRows.length > 0) {
    const claimTeacherIds = Array.from(new Set(claimRows.map((c) => c.teacher_id)));
    const { data: teacherRows } = await sb
      .from("users")
      .select("id, name")
      .in("id", claimTeacherIds);
    const teacherNameById = new Map(
      (teacherRows ?? []).map((t) => [t.id, t.name ?? "Преподаватель"]),
    );
    for (const c of claimRows) {
      claimByStudent.set(c.student_id, {
        teacher_id: c.teacher_id,
        teacher_name: teacherNameById.get(c.teacher_id) ?? "Преподаватель",
      });
    }
  }

  // Reduce per-student in JS — small N.
  const lastByStudent = new Map<number, MessageRow>();
  const unansweredByStudent = new Map<number, boolean>();
  const unreadByStudent = new Map<number, number>();
  for (const m of msgs) {
    if (!lastByStudent.has(m.student_id)) lastByStudent.set(m.student_id, m);
    if (m.direction === "in" && m.status === "pending") {
      unansweredByStudent.set(m.student_id, true);
    }
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
      return {
        student_id: sid,
        student_name: s?.name ?? null,
        has_avatar: !!s?.avatar_file_id,
        last_message: last
          ? {
              id: last.id,
              direction: last.direction,
              kind: last.kind,
              duration: last.duration,
              status: last.status,
              created_at: last.created_at,
            }
          : null,
        unread_count: unreadByStudent.get(sid) ?? 0,
        has_unanswered: unansweredByStudent.get(sid) ?? false,
        claim: claim
          ? {
              teacher_id: claim.teacher_id,
              teacher_name: claim.teacher_name,
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
