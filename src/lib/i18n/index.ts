/**
 * Aggregated user-facing string registry. Source of truth for everything
 * the user (student / teacher / admin) sees, whether via bot DM or the
 * Mini App. Modules:
 *   - `ru.bot`      — bot DMs (greetings, onboarding tree, quota, locked
 *                     templates, subscription DMs, fan-out notifications).
 *   - `ru.admin`    — admin Mini App surfaces.
 *   - `ru.student`  — student Mini App surfaces.
 *   - `ru.inbox`    — inbox + thread surfaces shared by teacher and admin.
 *   - `ru.common`   — generic verbs (Save / Cancel / Close) + Slavic plural
 *                     helpers used cross-surface.
 *
 * New strings always go in the matching surface module — never inline in
 * components, never as a fresh literal in a server handler. See CLAUDE.md.
 */

import { bot } from "./bot";
import { admin } from "./admin";
import { student } from "./student";
import { inbox } from "./inbox";
import { common, isSingularDay, pluralDay, pluralLink, pluralMinute } from "./common";

export const ru = {
  bot,
  admin,
  student,
  inbox,
  common,
};

export { isSingularDay, pluralDay, pluralLink, pluralMinute };

/**
 * Not strictly i18n — it's a helper that turns seconds into "M:SS". Kept
 * here as a peer re-export so existing `import { formatDuration } from
 * "@/lib/i18n"` call sites keep working. Move to `src/lib/format.ts` if/when
 * the file grows enough helpers to deserve its own home.
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Long-form Russian duration for the student summary card. Designed to
 * read like speech, not a timer ("5 минут", "1 мин 46 сек", "30 сек").
 * Use this where the value isn't a media-element elapsed counter; the
 * M:SS `formatDuration` stays for voice/video bubble labels (TG
 * convention).
 */
export function formatPracticeTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${s} сек`;
  if (r === 0) return `${m} ${pluralMinute(m)}`;
  return `${m} мин ${r} сек`;
}
