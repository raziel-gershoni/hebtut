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
  // Strip the optional seconds Postgres includes when serializing `time`
  // columns so downstream string-concat sees a clean "HH:MM" suffix.
  const start = normalizeHHMM(windowStart);
  const end = normalizeHHMM(windowEnd);
  if (start == null || end == null) return null;
  if (start === end) return null;

  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);
  if (startMin == null || endMin == null) return null;

  const nowMin = currentMinuteOfDay(now, tz);
  const isOvernight = startMin > endMin;
  const inside = isOvernight
    ? nowMin >= startMin || nowMin < endMin
    : nowMin >= startMin && nowMin < endMin;
  if (inside) return null;

  // Compute today's start in tz; if it's already past, roll to tomorrow.
  // `start` here is the normalized "HH:MM" form (no seconds), so the suffix
  // concatenation below is safe regardless of the input shape.
  const todayLocal = localDateInTz(now, tz);
  const todayStartUtc = fromZonedTime(
    `${todayLocal}T${start.padStart(5, "0")}:00`,
    tz,
  );
  if (todayStartUtc.getTime() > now.getTime()) return todayStartUtc;
  const tomorrowLocal = localDateInTz(addDays(parseISO(todayLocal), 1), tz);
  return fromZonedTime(`${tomorrowLocal}T${start.padStart(5, "0")}:00`, tz);
}

/**
 * Trim the trailing `:SS` Postgres tacks on when it serializes `time`
 * columns. Returns `null` if the input doesn't look like HH:MM at all so
 * malformed values fail fast instead of being silently let through.
 */
function normalizeHHMM(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function parseHHMM(s: string): number | null {
  // Accepts "HH:MM" (UI/form input) AND "HH:MM:SS" (the format Postgres
  // returns for the `time` column via Supabase). Without the optional
  // seconds, every value loaded from the DB silently failed to parse and
  // the bot treated configured windows as "always open" — a real outage,
  // not just a UI gripe.
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
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
