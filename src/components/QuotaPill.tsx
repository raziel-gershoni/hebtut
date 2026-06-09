import { ru } from "@/lib/i18n";

/**
 * Tutor-facing pill that signals a student is close to (≤30s) or past their
 * daily voice/video-note quota. Hidden when remaining > 30. Amber for the
 * warning band, red for at-or-over. The over-by amount is shown when the
 * student has gone past their cap (grace already consumed or large message).
 */
export function QuotaPill({ remainingSeconds }: { remainingSeconds: number }) {
  if (remainingSeconds > 30) return null;
  const isOver = remainingSeconds <= 0;
  const overBy = -remainingSeconds;

  let text: string;
  if (!isOver) {
    text = ru.inbox.quotaPill.warning(remainingSeconds);
  } else if (overBy === 0) {
    text = ru.inbox.quotaPill.over;
  } else {
    text = ru.inbox.quotaPill.overBy(overBy);
  }

  const aria = isOver
    ? ru.inbox.quotaPill.overAria
    : ru.inbox.quotaPill.warningAria;

  return (
    <span
      aria-label={aria}
      title={aria}
      className={`inline-flex items-center gap-1 px-2 h-5 rounded-full text-[11px] font-medium tabular-nums shrink-0 ${
        isOver
          ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
    >
      {text}
    </span>
  );
}
