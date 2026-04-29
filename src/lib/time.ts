import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { differenceInCalendarDays } from "date-fns";
import { ru } from "date-fns/locale/ru";

export function localDateInTz(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

/**
 * Russian-language "when this happened" string for the prompt the bot DMs
 * the teacher, computed in the teacher's timezone:
 *
 * - Today                → `в HH:mm`
 * - Yesterday            → `вчера в HH:mm`
 * - Day before yesterday → `позавчера в HH:mm`
 * - Older                → `DD.MM (понедельник) в HH:mm`
 *
 * Calendar-day deltas, not 24h windows — "today" is anchored to the
 * teacher's local clock, not "less than 24h ago".
 */
export function formatWhen(iso: string, tz: string): string {
  const sent = new Date(iso);
  const sentLocal = toZonedTime(sent, tz);
  const nowLocal = toZonedTime(new Date(), tz);
  const days = differenceInCalendarDays(nowLocal, sentLocal);
  const time = formatInTimeZone(sent, tz, "HH:mm");
  if (days <= 0) return `в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  if (days === 2) return `позавчера в ${time}`;
  const date = formatInTimeZone(sent, tz, "dd.MM");
  const weekday = formatInTimeZone(sent, tz, "EEEE", { locale: ru });
  return `${date} (${weekday}) в ${time}`;
}
