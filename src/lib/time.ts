import { formatInTimeZone } from "date-fns-tz";

export function localDateInTz(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}
