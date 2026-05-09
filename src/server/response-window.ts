import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays, parseISO } from "date-fns";
import { localDateInTz } from "@/lib/time";

/**
 * "When does the student's response window next open?"
 *
 * Returns a UTC `Date` representing the next open instant after `now`, or
 * `null` if `now` is already inside the window (i.e., deliver immediately).
 *
 * Window semantics:
 *   - Both fields null OR both set to the same time → no window (always-on);
 *     returns null.
 *   - start < end (same-day) → window is [start, end) on each calendar day
 *     in the student's tz.
 *   - start > end (overnight) → window wraps midnight: [start, 24:00) ∪
 *     [0:00, end). e.g. 21:00–09:00 covers evenings + mornings.
 *
 * Pure: takes only the inputs; no DB or env access. Easy to unit-test.
 */
export function nextWindowOpen(
  now: Date,
  windowStart: string | null,
  windowEnd: string | null,
  tz: string,
): Date | null {
  if (!windowStart || !windowEnd) return null;
  if (windowStart === windowEnd) return null;

  const startMin = parseHHMM(windowStart);
  const endMin = parseHHMM(windowEnd);
  if (startMin == null || endMin == null) return null;

  const nowMin = currentMinuteOfDay(now, tz);
  const isOvernight = startMin > endMin;
  const inside = isOvernight
    ? nowMin >= startMin || nowMin < endMin
    : nowMin >= startMin && nowMin < endMin;
  if (inside) return null;

  // Compute today's start in tz; if it's already past, roll to tomorrow.
  const todayLocal = localDateInTz(now, tz);
  const todayStartUtc = fromZonedTime(
    `${todayLocal}T${windowStart.padStart(5, "0")}:00`,
    tz,
  );
  if (todayStartUtc.getTime() > now.getTime()) return todayStartUtc;
  const tomorrowLocal = localDateInTz(addDays(parseISO(todayLocal), 1), tz);
  return fromZonedTime(`${tomorrowLocal}T${windowStart.padStart(5, "0")}:00`, tz);
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function currentMinuteOfDay(now: Date, tz: string): number {
  const hh = Number(formatInTimeZone(now, tz, "HH"));
  const mm = Number(formatInTimeZone(now, tz, "mm"));
  return hh * 60 + mm;
}
