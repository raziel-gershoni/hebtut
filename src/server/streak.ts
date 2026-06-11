import { addDays, format, parseISO } from "date-fns";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";

export const PRACTICE_THRESHOLD_SECONDS = 30;
const LOOKBACK_DAYS = 30;

/**
 * Consecutive practice-day count anchored to "today in the student's tz".
 * A day counts when `quota_usage.seconds_used >= PRACTICE_THRESHOLD_SECONDS`
 * (≥ 30s — enough to call it a real attempt without false-positive hot mics).
 *
 * Today's row is optional: if the student hasn't practiced YET today, the
 * streak is still N — the count from yesterday backwards. Logging today's
 * first message later in the same calendar day extends it to N+1.
 *
 * Walk back at most LOOKBACK_DAYS days to keep this O(30) at most.
 */
export async function computeStreak(userId: number, tz: string): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  const earliest = format(addDays(parseISO(today), -LOOKBACK_DAYS), "yyyy-MM-dd");

  const { data: rows } = await sb
    .from("quota_usage")
    .select("date, seconds_used")
    .eq("student_id", userId)
    .gte("date", earliest)
    .lte("date", today)
    .order("date", { ascending: false });
  if (!rows?.length) return 0;

  const byDate = new Map(rows.map((r) => [r.date, r.seconds_used]));
  let streak = 0;
  let cursor = parseISO(today);

  // If today has no practice yet, start counting from yesterday — today's
  // absence shouldn't break a multi-day streak that's still "active."
  const todayUsed = byDate.get(today) ?? 0;
  if (todayUsed < PRACTICE_THRESHOLD_SECONDS) {
    cursor = addDays(cursor, -1);
  }
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const key = format(cursor, "yyyy-MM-dd");
    const used = byDate.get(key) ?? 0;
    if (used < PRACTICE_THRESHOLD_SECONDS) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
