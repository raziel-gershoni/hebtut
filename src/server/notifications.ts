import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { resolveDisplay } from "@/server/display";
import { getDisplayAnonymousHandlesEnabled } from "@/server/settings";
import { serverEnv } from "@/lib/env";
import { formatInTimeZone } from "date-fns-tz";

// Used by the fan-out copy below — picks the user's display label per the
// global names-vs-handles toggle. Resolved at the start of the fan-out so a
// single notification batch uses one consistent mode.
function handleFromDisplay(
  row:
    | {
        tg_user_id: number;
        name?: string | null;
        preferred_name?: string | null;
        display_handle: string | null;
        display_emoji?: string | null;
        avatar_file_id?: string | null;
      }
    | null
    | undefined,
  anonMode: boolean,
): string {
  return resolveDisplay(
    {
      tg_user_id: row?.tg_user_id ?? null,
      name: row?.name ?? null,
      preferred_name: row?.preferred_name ?? null,
      display_handle: row?.display_handle ?? null,
      display_emoji: row?.display_emoji ?? null,
      avatar_file_id: row?.avatar_file_id ?? null,
    },
    anonMode,
  ).handle;
}

/**
 * Notify every teacher linked to the student about a new inbound message.
 * If a teacher already holds an active claim on this student, OTHER linked
 * teachers see the "✓ T handling" state immediately so they don't try to
 * claim. The holder gets the actionable copy.
 */
export async function fanOutToTeachers(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, kind, duration, student_id, reply_to_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;

  // If this inbound was a swipe-reply to a teacher bubble, pull the
  // parent's details + author handle so we can augment the actionable
  // copy with "ответ на твоё/X-тренера ... от HH:MM". Parent author
  // resolution failure (deleted teacher row, race) falls back to the
  // un-augmented copy — silent degrade, not a hard error.
  const { data: parent } =
    msg.reply_to_id != null
      ? await sb
          .from("messages")
          .select("id, kind, duration, created_at, teacher_id")
          .eq("id", msg.reply_to_id)
          .maybeSingle()
      : { data: null };
  const { data: parentTeacher } =
    parent?.teacher_id != null
      ? await sb
          .from("users")
          .select(
            "tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id",
          )
          .eq("id", parent.teacher_id)
          .maybeSingle()
      : { data: null };

  // Resolve once for the whole fan-out so a flip mid-batch doesn't yield
  // inconsistent copy across the messages we send.
  const anonMode = await getDisplayAnonymousHandlesEnabled();

  const { data: student } = await sb
    .from("users")
    .select("tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id")
    .eq("id", msg.student_id)
    .single();
  const studentHandle = handleFromDisplay(student, anonMode);

  const { data: links } = await sb
    .from("student_teachers")
    .select("teacher_id")
    .eq("student_id", msg.student_id);
  if (!links?.length) return;
  const teacherIds = links.map((l) => l.teacher_id);

  // Active session check.
  const { data: claim } = await sb
    .from("claims")
    .select("teacher_id, expires_at")
    .eq("student_id", msg.student_id)
    .maybeSingle();
  const handlerId =
    claim && new Date(claim.expires_at).getTime() > Date.now() ? claim.teacher_id : null;

  const handlerHandle = handlerId
    ? handleFromDisplay(
        (
          await sb
            .from("users")
            .select("tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id")
            .eq("id", handlerId)
            .single()
        ).data,
        anonMode,
      )
    : null;

  const { data: teachers } = await sb
    .from("users")
    .select("id, tg_chat_id")
    .in("id", teacherIds);
  if (!teachers?.length) return;

  const bot = getBot();
  const kindLabel = msg.kind === "voice" ? ru.bot.labels.voiceLower : ru.bot.labels.videoNoteLower;
  const durationLabel = formatDuration(msg.duration);
  const parentKindLabel = parent
    ? parent.kind === "voice"
      ? ru.bot.labels.voiceLower
      : parent.kind === "video_note"
        ? ru.bot.labels.videoNoteLower
        : ru.bot.labels.textLower
    : "";
  const parentTimeLabel = parent
    ? formatParentTime(parent.created_at, "Asia/Jerusalem", new Date())
    : "";
  const parentTeacherHandle = parentTeacher
    ? handleFromDisplay(parentTeacher, anonMode)
    : "";
  const plainActionable = ru.bot.notifications.teacherNotificationActionable(
    studentHandle,
    kindLabel,
    durationLabel,
  );
  const taken = (name: string) => ru.bot.notifications.teacherNotificationTaken(name, studentHandle);

  const rows: {
    message_id: number;
    teacher_id: number;
    tg_chat_id: number;
    tg_notification_message_id: number;
  }[] = [];
  for (const t of teachers) {
    let actionable: string;
    if (parent && parentTeacher) {
      actionable =
        parent.teacher_id === t.id
          ? ru.bot.notifications.teacherNotificationActionableReplyMine(
              studentHandle,
              kindLabel,
              durationLabel,
              parentKindLabel,
              parentTimeLabel,
            )
          : ru.bot.notifications.teacherNotificationActionableReplyOther(
              studentHandle,
              kindLabel,
              durationLabel,
              parentTeacherHandle,
              parentKindLabel,
              parentTimeLabel,
            );
    } else {
      actionable = plainActionable;
    }
    const text =
      handlerId && handlerId !== t.id ? taken(handlerHandle ?? "Тренер") : actionable;
    try {
      const sent = await bot.api.sendMessage(t.tg_chat_id, text);
      rows.push({
        message_id: msg.id,
        teacher_id: t.id,
        tg_chat_id: t.tg_chat_id,
        tg_notification_message_id: sent.message_id,
      });
    } catch (e) {
      console.error("fan-out send failed", e);
    }
  }
  if (rows.length) {
    await sb.from("notifications").insert(rows);
  }
}

/**
 * Fans out a DM to every admin when a student with no row in
 * `student_teachers` sends a message. Mirrors `fanOutFeedbackToAdmins`
 * in `src/server/feedback.ts`. The inline `web_app` button deep-links
 * into the Mini App inbox with `?focus_student=<id>`, which the inbox
 * page reads to auto-open the AssignTeacherDialog.
 *
 * Fail-soft per admin — one bad chat_id doesn't sink the batch.
 */
export async function fanOutUnassignedToAdmins(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, kind, duration, student_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;

  const anonMode = await getDisplayAnonymousHandlesEnabled();
  const { data: student } = await sb
    .from("users")
    .select("tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id")
    .eq("id", msg.student_id)
    .single();
  if (!student) return;
  const studentLabel = handleFromDisplay(student, anonMode);

  const { data: admins } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("is_admin", true);
  if (!admins?.length) return;

  const url = `${serverEnv.APP_BASE_URL.replace(/\/$/, "")}/inbox?focus_student=${msg.student_id}`;
  const kindLabel = msg.kind === "voice" ? ru.bot.labels.voiceUpper : ru.bot.labels.videoNoteUpper;
  const text = ru.bot.notifications.adminUnassignedPing(studentLabel, kindLabel);

  const bot = getBot();
  for (const admin of admins) {
    try {
      await bot.api.sendMessage(admin.tg_chat_id, text, {
        reply_markup: {
          inline_keyboard: [[{ text: "Назначить тренера", web_app: { url } }]],
        },
      });
    } catch (e) {
      console.warn("unassigned admin DM failed", {
        chat_id: admin.tg_chat_id,
        reason: (e as Error).message,
      });
    }
  }
}

/**
 * DM every admin when a brand-new user is registered (student via /start,
 * teacher via invite, or student via the auto-register-on-first-media
 * fallback). Bootstrap admin self-create is not hooked. Fail-soft per
 * admin — one bad chat_id doesn't sink the batch.
 */
export async function fanOutNewUserToAdmins(
  newUserId: number,
  via: "start" | "invite" | "media",
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select(
      "id, role, tg_user_id, name, preferred_name, display_handle, display_emoji, avatar_file_id",
    )
    .eq("id", newUserId)
    .single();
  if (!user) return;

  const anonMode = await getDisplayAnonymousHandlesEnabled();
  const label = handleFromDisplay(user, anonMode);
  const roleLabel =
    user.role === "teacher" ? ru.bot.labels.roleTeacher : ru.bot.labels.roleStudent;
  const viaLabel = via === "invite" ? ru.bot.labels.viaInviteSuffix : "";
  const text = ru.bot.notifications.adminNewUserPing(label, roleLabel, viaLabel);

  const { data: admins } = await sb
    .from("users")
    .select("id, tg_chat_id")
    .eq("is_admin", true);
  if (!admins?.length) return;

  const url = `${serverEnv.APP_BASE_URL.replace(/\/$/, "")}/admin`;
  const bot = getBot();
  for (const admin of admins) {
    if (admin.id === newUserId) continue;
    try {
      await bot.api.sendMessage(admin.tg_chat_id, text, {
        reply_markup: {
          inline_keyboard: [[{ text: ru.bot.labels.openInline, web_app: { url } }]],
        },
      });
    } catch (e) {
      console.warn("new-user admin DM failed", {
        chat_id: admin.tg_chat_id,
        reason: (e as Error).message,
      });
    }
  }
}

export async function editAllNotificationsForMessage(
  messageId: number,
  text: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: notifs } = await sb
    .from("notifications")
    .select("tg_chat_id, tg_notification_message_id")
    .eq("message_id", messageId);
  if (!notifs) return;
  const bot = getBot();
  for (const n of notifs) {
    try {
      await bot.api.editMessageText(n.tg_chat_id, n.tg_notification_message_id, text);
    } catch (e) {
      // Telegram returns 400 when content is unchanged or message is too old; safe to ignore.
      console.warn("editMessageText", e);
    }
  }
}

/**
 * Format the parent message's timestamp for the fan-out reply context.
 * Same-day in the student's tz → bare "HH:mm" (overwhelmingly common
 * case, reads tighter); cross-day → "dd.MM HH:mm" so a swipe-reply to
 * yesterday's tutor voice doesn't render as a confusing same-day time.
 */
function formatParentTime(iso: string, tz: string, now: Date): string {
  const parentDay = formatInTimeZone(iso, tz, "yyyy-MM-dd");
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
  return parentDay === today
    ? formatInTimeZone(iso, tz, "HH:mm")
    : formatInTimeZone(iso, tz, "dd.MM HH:mm");
}
