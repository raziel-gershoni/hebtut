/**
 * TG-style per-speaker color assignment for the thread view. Each non-self
 * speaker gets one of 7 hues deterministically based on their user_id.
 * The current viewer's own messages get a distinct "self" hue (Tailwind
 * amber) — picked deliberately outside the rotation so a non-self speaker
 * can never collide with "you", and tuned to a slightly stronger alpha so
 * "Me" reads as the standout color in any thread.
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
  /** Stronger tint for the inset reply-context chip body so it visibly
   *  reads as a card-inside-the-bubble. */
  replyBg: string;
}

type Hue = "emerald" | "sky" | "violet" | "rose" | "teal" | "pink" | "indigo";

const PALETTE: Record<Hue | "self", SpeakerColorClasses> = {
  emerald: {
    border: "border-emerald-500",
    name: "text-emerald-600 dark:text-emerald-400",
    bubbleBg: "bg-emerald-500/[0.08]",
    replyBg: "bg-emerald-500/[0.18]",
  },
  sky: {
    border: "border-sky-500",
    name: "text-sky-600 dark:text-sky-400",
    bubbleBg: "bg-sky-500/[0.08]",
    replyBg: "bg-sky-500/[0.18]",
  },
  violet: {
    border: "border-violet-500",
    name: "text-violet-600 dark:text-violet-400",
    bubbleBg: "bg-violet-500/[0.08]",
    replyBg: "bg-violet-500/[0.18]",
  },
  rose: {
    border: "border-rose-500",
    name: "text-rose-600 dark:text-rose-400",
    bubbleBg: "bg-rose-500/[0.08]",
    replyBg: "bg-rose-500/[0.18]",
  },
  teal: {
    border: "border-teal-500",
    name: "text-teal-600 dark:text-teal-400",
    bubbleBg: "bg-teal-500/[0.08]",
    replyBg: "bg-teal-500/[0.18]",
  },
  pink: {
    border: "border-pink-500",
    name: "text-pink-600 dark:text-pink-400",
    bubbleBg: "bg-pink-500/[0.08]",
    replyBg: "bg-pink-500/[0.18]",
  },
  indigo: {
    border: "border-indigo-500",
    name: "text-indigo-600 dark:text-indigo-400",
    bubbleBg: "bg-indigo-500/[0.08]",
    replyBg: "bg-indigo-500/[0.18]",
  },
  self: {
    border: "border-amber-500",
    name: "text-amber-600 dark:text-amber-400",
    bubbleBg: "bg-amber-500/[0.12]",
    replyBg: "bg-amber-500/[0.24]",
  },
};

const HUES: Hue[] = ["emerald", "sky", "violet", "rose", "teal", "pink", "indigo"];

export function speakerColor(userId: number, isSelf: boolean): SpeakerColorClasses {
  if (isSelf) return PALETTE.self;
  const i = ((userId % HUES.length) + HUES.length) % HUES.length;
  return PALETTE[HUES[i]!];
}
