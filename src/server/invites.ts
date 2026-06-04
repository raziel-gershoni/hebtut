import { getServiceRoleClient } from "@/lib/supabase-server";
import { userHandle } from "@/lib/handle";

const PAYLOAD_PREFIX = "invite_";
const REF_PREFIX = "ref_";
const SRC_PREFIX = "src_";

/**
 * Strips the `ref_` prefix and validates a referral token's shape. Same
 * length / charset bounds as invite tokens — see parseInvitePayload.
 */
export function parseRefPayload(payload: string | undefined | null): string | null {
  if (!payload) return null;
  if (!payload.startsWith(REF_PREFIX)) return null;
  const token = payload.slice(REF_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(token)) return null;
  return token;
}

export function buildReferralUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${REF_PREFIX}${token}`;
}

/**
 * Strips the `src_` prefix and validates an advertiser acquisition-source
 * slug. Slug shape mirrors the slugify output in the admin endpoint:
 * lowercase alnum + hyphen, starting with alnum, 1..40 chars total.
 */
export function parseSrcPayload(payload: string | undefined | null): string | null {
  if (!payload) return null;
  if (!payload.startsWith(SRC_PREFIX)) return null;
  const slug = payload.slice(SRC_PREFIX.length).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return null;
  return slug;
}

export function buildAcquisitionUrl(botUsername: string, slug: string): string {
  return `https://t.me/${botUsername}?start=${SRC_PREFIX}${slug}`;
}

/**
 * Strips the `invite_` prefix and validates the token's shape. Returns null if
 * the payload isn't an invite payload or the token is malformed. No DB hit.
 *
 * Token shape is base64url (24 random bytes → 32 chars), matching what
 * `POST /api/admin/invites` mints. Length-bounded so a junk payload doesn't
 * trigger a DB lookup.
 */
export function parseInvitePayload(payload: string | undefined | null): string | null {
  if (!payload) return null;
  if (!payload.startsWith(PAYLOAD_PREFIX)) return null;
  const token = payload.slice(PAYLOAD_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return token;
}

export function buildInviteUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${PAYLOAD_PREFIX}${token}`;
}

/** SELECT-only validity check. Used to *decide* the welcome path. */
export async function isInviteValid(token: string): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("teacher_invites")
    .select("id")
    .eq("token", token)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  return !!data;
}

/**
 * Atomically marks the invite consumed and flips the user's role to teacher.
 * Returns true iff exactly one invite row was claimed by this call (so two
 * concurrent /start clicks don't both succeed). The role update follows only
 * if the consume won the race.
 */
export async function consumeInviteAndUpgrade(
  token: string,
  userId: number,
): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data: claimed } = await sb
    .from("teacher_invites")
    .update({ consumed_at: new Date().toISOString(), consumed_by: userId })
    .eq("token", token)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;
  await sb
    .from("users")
    .update({ role: "teacher", role_changed_at: new Date().toISOString() })
    .eq("id", userId);
  return true;
}

/**
 * For a brand-new user opening a teacher invite link: insert the user row as
 * a teacher and consume the invite in two steps. If the consume loses a race
 * (another click took the same invite first), we roll the insert back so the
 * caller can fall through to the student path.
 */
export async function createTeacherWithInvite(args: {
  tgUserId: number;
  tgChatId: number;
  name: string;
  tgUsername: string | null;
  token: string;
}): Promise<{ id: number } | null> {
  const sb = getServiceRoleClient();
  const h = userHandle(args.tgUserId);
  const { data: inserted } = await sb
    .from("users")
    .insert({
      tg_user_id: args.tgUserId,
      tg_chat_id: args.tgChatId,
      name: args.name,
      tg_username: args.tgUsername,
      display_handle: h.handle,
      display_emoji: h.emoji,
      role: "teacher",
    })
    .select("id")
    .single();
  if (!inserted) return null;
  const won = await consumeInviteAndUpgrade(args.token, inserted.id);
  if (!won) {
    // Race lost — undo so the caller can retry as a plain student.
    await sb.from("users").delete().eq("id", inserted.id);
    return null;
  }
  return inserted;
}

export async function createStudent(args: {
  tgUserId: number;
  tgChatId: number;
  name: string;
  tgUsername: string | null;
}): Promise<{ id: number } | null> {
  const sb = getServiceRoleClient();
  const h = userHandle(args.tgUserId);
  const { data: inserted } = await sb
    .from("users")
    .insert({
      tg_user_id: args.tgUserId,
      tg_chat_id: args.tgChatId,
      name: args.name,
      tg_username: args.tgUsername,
      display_handle: h.handle,
      display_emoji: h.emoji,
      role: "student",
    })
    .select("id")
    .single();
  if (!inserted) return null;
  // Provision the subscription row immediately so the onboarding state
  // machine has a place to live. Without this, `subscriptions` is null
  // for fresh students and the callback handler defaults state to
  // 'done_skipped' — which makes the very first "Начать" tap fire the
  // "Кнопка устарела" toast. Defaults: status='queued' (no clock yet —
  // trial starts fresh on first tutor link), onboarding_state='welcome'
  // (matches the Step 1 message we just sent).
  await sb
    .from("subscriptions")
    .upsert({ user_id: inserted.id, status: "queued" }, { onConflict: "user_id" });
  return inserted;
}

export async function isTgUserBanned(tgUserId: number): Promise<boolean> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("banned_tg_users")
    .select("tg_user_id")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  return !!data;
}
