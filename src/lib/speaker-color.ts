/**
 * TG-style per-speaker color assignment for the thread view. Each non-self
 * speaker gets one of 8 hues deterministically based on their user_id, so
 * a given user always shows up in the same color. The current viewer's own
 * messages get a "self" color anchored to TG's theme button, keeping their
 * bubbles theme-coherent across light/dark.
 *
 * Static class strings are referenced literally inside PALETTE so Tailwind's
 * JIT picks them up — no safelist needed.
 */

export interface SpeakerColorClasses {
  /** Bubble side border + reply chip bar — full opacity, used at 3px. */
  border: string;
  /** Speaker name color in the meta row + reply chip header. */
  name: string;
  /** Bubble background — barely-visible tint of the speaker's hue. */
  bubbleBg: string;
  /** Subtle tint for the inset reply-context chip body (slightly stronger). */
  replyBg: string;
}

type Hue = "emerald" | "sky" | "violet" | "amber" | "rose" | "teal" | "pink" | "indigo";

const PALETTE: Record<Hue | "self", SpeakerColorClasses> = {
  emerald: {
    border: "border-emerald-500",
    name: "text-emerald-600 dark:text-emerald-400",
    bubbleBg: "bg-emerald-500/[0.08]",
    replyBg: "bg-emerald-500/[0.14]",
  },
  sky: {
    border: "border-sky-500",
    name: "text-sky-600 dark:text-sky-400",
    bubbleBg: "bg-sky-500/[0.08]",
    replyBg: "bg-sky-500/[0.14]",
  },
  violet: {
    border: "border-violet-500",
    name: "text-violet-600 dark:text-violet-400",
    bubbleBg: "bg-violet-500/[0.08]",
    replyBg: "bg-violet-500/[0.14]",
  },
  amber: {
    border: "border-amber-500",
    name: "text-amber-600 dark:text-amber-400",
    bubbleBg: "bg-amber-500/[0.10]",
    replyBg: "bg-amber-500/[0.18]",
  },
  rose: {
    border: "border-rose-500",
    name: "text-rose-600 dark:text-rose-400",
    bubbleBg: "bg-rose-500/[0.08]",
    replyBg: "bg-rose-500/[0.14]",
  },
  teal: {
    border: "border-teal-500",
    name: "text-teal-600 dark:text-teal-400",
    bubbleBg: "bg-teal-500/[0.08]",
    replyBg: "bg-teal-500/[0.14]",
  },
  pink: {
    border: "border-pink-500",
    name: "text-pink-600 dark:text-pink-400",
    bubbleBg: "bg-pink-500/[0.08]",
    replyBg: "bg-pink-500/[0.14]",
  },
  indigo: {
    border: "border-indigo-500",
    name: "text-indigo-600 dark:text-indigo-400",
    bubbleBg: "bg-indigo-500/[0.08]",
    replyBg: "bg-indigo-500/[0.14]",
  },
  self: {
    border: "border-tg-button",
    name: "text-tg-text-accent",
    bubbleBg: "bg-tg-button/[0.10]",
    replyBg: "bg-tg-button/[0.16]",
  },
};

const HUES: Hue[] = ["emerald", "sky", "violet", "amber", "rose", "teal", "pink", "indigo"];

export function speakerColor(userId: number, isSelf: boolean): SpeakerColorClasses {
  if (isSelf) return PALETTE.self;
  const i = ((userId % HUES.length) + HUES.length) % HUES.length;
  return PALETTE[HUES[i]!];
}
