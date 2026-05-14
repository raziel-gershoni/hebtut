import { userHandle } from "@/lib/handle";

/**
 * Resolves how a user should be SHOWN on peer-facing surfaces. Driven by the
 * global `display_anonymous_handles_enabled` toggle:
 *
 * - OFF (default, names mode): handle = real name from `users.name` (collected
 *   in the awaiting_name onboarding step). `emoji` is null. `has_avatar` is
 *   true when the user has a Telegram profile photo on file — frontend
 *   constructs `/api/avatar/${user_id}?token=...` itself; falsy means render
 *   initials.
 * - ON (legacy anonymous mode): handle = `users.display_handle` (e.g. "Гордый
 *   Орёл"), `emoji` = `users.display_emoji` (🦅). Emoji on a colored circle —
 *   no avatar, no real name.
 *
 * Both fields stay populated on `users` regardless of mode — only the render
 * picks. Switching modes is one global toggle, no per-user migration.
 */
export type DisplayRow = {
  tg_user_id: number | null;
  name: string | null;
  display_handle: string | null;
  display_emoji: string | null;
  avatar_file_id?: string | null;
};

export interface DisplayShape {
  handle: string;
  emoji: string | null;
  has_avatar: boolean;
}

export function resolveDisplay(
  row: DisplayRow | null | undefined,
  anonMode: boolean,
): DisplayShape {
  if (anonMode) {
    const handle = row?.display_handle ?? null;
    const emoji = row?.display_emoji ?? null;
    if (handle && emoji) {
      return { handle, emoji, has_avatar: false };
    }
    const fallback = userHandle(row?.tg_user_id ?? 0);
    return {
      handle: handle ?? fallback.handle,
      emoji: emoji ?? fallback.emoji,
      has_avatar: false,
    };
  }
  return {
    handle: row?.name?.trim() || "Ученик",
    emoji: null,
    has_avatar: !!row?.avatar_file_id,
  };
}
