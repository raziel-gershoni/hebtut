import { differenceInCalendarYears, format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

/**
 * Centered day-divider pill rendered between messages in a thread when
 * the calendar day changes. Format mirrors Telegram itself:
 *   "Сегодня"          for today
 *   "Вчера"            for yesterday
 *   "13 мая"           for older dates within this calendar year
 *   "13 мая 2025"      for prior years
 */
export function DateSeparator({ at }: { at: Date }) {
  const now = new Date();
  let label: string;
  if (isToday(at)) label = "Сегодня";
  else if (isYesterday(at)) label = "Вчера";
  else if (differenceInCalendarYears(now, at) === 0) {
    label = format(at, "d MMMM", { locale: ru });
  } else {
    label = format(at, "d MMMM yyyy", { locale: ru });
  }
  return (
    <div className="flex justify-center my-3">
      <span className="text-[11px] font-medium tracking-wide text-tg-text-hint bg-tg-bg-section rounded-full px-3 py-1 select-none">
        {label}
      </span>
    </div>
  );
}
